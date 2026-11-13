begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);
-- Mandatory native205->206 proof: absence of this committed fixture is failure.
create temporary table cash_mode_adoption_terminal(withdrawal_id uuid not null);
do $$declare c record;j jsonb;s jsonb;t uuid;d uuid;p uuid;prepared jsonb;r uuid;begin
 select * into strict c from workroom_native_evidence.cash_mode_context;
 select jsonb_build_object('activation',to_jsonb(a),
 'states',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_engine_state_receipts x where user_id=c.user_id),
 'conditions',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_condition_originals x where user_id=c.user_id),
 'cycles',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_cycle_windows x where user_id=c.user_id)) into strict j
 from app_private.funding_engine_activations a where a.id=c.activation_id;
 if j is distinct from c.originals then raise exception 'ADOPTION_CHANGED_ENGINE_ORIGINALS';end if;
 if not exists(select 1 from app_private.workroom_cash_enrollments e where e.user_id=c.user_id
   and e.preserved_activation_id=c.activation_id and e.reason='INERT_ACTIVATION_PRESERVED')then
  raise exception 'INERT_ACTIVATION_NOT_ADOPTED';end if;
 insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,fee_atomic,
  destination_config,effective_at,approved_by,allows_welcome_reward)
 values('KRW','KRW_BANK',11651302,true,1,0,'{"allowed_bank_codes":["KB"]}',clock_timestamp()-interval '1 hour',c.admin_id,false)
 returning id into p;
 insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,display_hint,
  verification_status,verified_at,protection_until)
 values(c.user_id,'KRW_BANK',decode(repeat('ab',32),'hex'),encode(extensions.digest(c.user_id::text||'cash-mode','sha256'),'hex'),
  'KB ••••1234','VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day') returning id into d;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 s:=public.read_workroom_cash(c.user_id);
 if s->>'ready' is distinct from 'true'or s->>'depositedKrw' is distinct from '100000'or s->>'availableKrw' is distinct from '100000'then
  raise exception 'ADOPTED_APPROVED_CASH_NOT_VISIBLE %',s;end if;
 t:=public.approve_deposit_request(c.request_id,c.admin_id,100000,'cash-mode-before-approve',
  'Disposable native actual approved100000',gen_random_uuid());
 if t is distinct from c.transaction_id then raise exception 'APPROVAL_REPLAY_CHANGED_TRANSACTION';end if;
 perform public.approve_deposit_request(public.create_deposit_request(c.user_id,'KRW',5000,'cash-mode-adopt-next-request'),
  c.admin_id,5000,'cash-mode-adopt-next-approve','Disposable subsequent approved cash',gen_random_uuid());
 s:=public.read_workroom_cash(c.user_id);
 if s->>'ready' is distinct from 'true'or s->>'depositedKrw' is distinct from '105000'or s->>'availableKrw' is distinct from '105000'then
  raise exception 'SUBSEQUENT_ADOPTED_CASH_NOT_VISIBLE %',s;end if;
 prepared:=public.prepare_workroom_cash_withdrawal(c.user_id,'KRW_BANK',25000,p,11651302,null,d);
 r:=public.hold_workroom_cash_withdrawal(c.user_id,prepared->>'key','KRW_BANK',d,25000);
 s:=public.read_workroom_cash(c.user_id);
 if s->>'availableKrw' is distinct from '80000'or s->>'heldKrw' is distinct from '25000'then
  raise exception 'ADOPTED_WITHDRAWAL_HOLD_FOLD_INVALID %',s;end if;
 perform public.release_withdrawal_hold(r,c.admin_id,'Disposable adopted cash cancellation','cash-mode-adopt-release','CANCELLED');
 s:=public.read_workroom_cash(c.user_id);
 if s->>'ready' is distinct from 'true'or s->>'availableKrw' is distinct from '105000'
  or s->>'heldKrw' is distinct from '0'or s->>'withdrawnKrw' is distinct from '0'then
  raise exception 'ADOPTED_WITHDRAWAL_RELEASE_FOLD_INVALID %',s;end if;
 perform public.resolve_withdrawal_logical_request(c.user_id,'CONFIRM',prepared->>'key',r);
 prepared:=public.prepare_workroom_cash_withdrawal(c.user_id,'KRW_BANK',15000,p,11651302,null,d);
 r:=public.hold_workroom_cash_withdrawal(c.user_id,prepared->>'key','KRW_BANK',d,15000);
 perform public.record_krw_external_send(r,'CASH-MODE-NATIVE-15000',15000,c.admin_id,clock_timestamp(),'cash-mode-adopt-send');
 s:=public.read_workroom_cash(c.user_id);
 if s->>'availableKrw' is distinct from '90000'or s->>'heldKrw' is distinct from '15000'
  or s->>'withdrawnKrw' is distinct from '0'then raise exception 'ADOPTED_SENT_HOLD_FOLD_INVALID %',s;end if;
 perform set_config('role','postgres',true);
 insert into pg_temp.cash_mode_adoption_terminal values(r);
 if exists(select 1 from app_private.funding_earned_receipts where user_id=c.user_id)
  or exists(select 1 from app_private.funding_engine_jobs where user_id=c.user_id)
  or(select count(*)from app_private.funding_engine_state_receipts where user_id=c.user_id)<>1
  or(select count(*)from app_private.funding_engine_activations where user_id=c.user_id)<>1
  or(select count(*)from public.money_source_movements where user_id=c.user_id and movement_kind='CREDIT')<>2 then
  raise exception 'ADOPTED_CREDIT_CREATED_ENGINE_OR_DUPLICATE';end if;
 if not exists(select 1 from app_private.funding_credit_boundary_completions x
   where x.user_id=c.user_id and x.runtime_outcome='UNRESOLVED'and x.reason_code='WORKROOM_DIRECT_CASH_MODE')then
  raise exception 'SUBSEQUENT_CREDIT_MODE_RECEIPT_MISSING';end if;
end$$;
-- Canonical finalization uses statement_timestamp(), so it must be a later
-- statement than the HOLD and its synthetic external-send original.
do $$declare c record;r uuid;t uuid;s jsonb;j jsonb;begin
 select * into strict c from workroom_native_evidence.cash_mode_context;
 select withdrawal_id into strict r from pg_temp.cash_mode_adoption_terminal;
 perform set_config('role','service_role',true);
 t:=public.finalize_withdrawal_ledger(r,c.admin_id,'cash-mode-adopt-finalize');
 if public.finalize_withdrawal_ledger(r,c.admin_id,'cash-mode-adopt-finalize') is distinct from t then
  raise exception 'ADOPTED_FINALIZE_REPLAY_CHANGED_TRANSACTION';end if;
 s:=public.read_workroom_cash(c.user_id);
 if s->>'ready' is distinct from 'true'or s->>'availableKrw' is distinct from '90000'
  or s->>'depositedKrw' is distinct from '105000'or s->>'withdrawnKrw' is distinct from '15000'
  or s->>'heldKrw' is distinct from '0'then raise exception 'ADOPTED_FINALIZE_CASH_FOLD_INVALID %',s;end if;
 perform set_config('role','postgres',true);
 if exists(select 1 from app_private.funding_earned_receipts where user_id=c.user_id)
  or exists(select 1 from app_private.funding_engine_jobs where user_id=c.user_id)
  or(select count(*)from public.wallet_ledger where reference_type='withdrawal_request'and reference_id=r)<>1 then
  raise exception 'ADOPTED_FINALIZE_DUPLICATED_OR_CREATED_ENGINE';end if;
 select jsonb_build_object('activation',to_jsonb(a),
 'states',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_engine_state_receipts x where user_id=c.user_id),
 'conditions',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_condition_originals x where user_id=c.user_id),
 'cycles',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_cycle_windows x where user_id=c.user_id)) into strict j
 from app_private.funding_engine_activations a where a.id=c.activation_id;
 if j is distinct from c.originals then raise exception 'ADOPTED_FINALIZE_CHANGED_ENGINE_ORIGINALS';end if;
end$$;

do $$declare c record;begin
 select * into strict c from workroom_native_evidence.cash_mode_legacy_control;
 if exists(select 1 from app_private.workroom_cash_enrollments where user_id=c.user_id)
  or(select count(*)from app_private.funding_engine_state_receipts where user_id=c.user_id)<>c.states
  or(select count(*)from app_private.funding_earned_receipts where user_id=c.user_id)<>c.earned then
  raise exception 'ESTABLISHED_LEGACY_HISTORY_ADOPTED_OR_CHANGED';end if;
end$$;
set constraints all immediate;
select extensions.pass('205 inert activation preserved;206 exposes same approved cash and isolates subsequent credit');
select * from extensions.finish();
rollback;
