begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local time zone 'UTC';
-- Regression scope: actual deposit approval, canonical terminal writer,
-- rollover and withdrawal of that exact earned credit through native finalize. Synthetic history is rollback-only, never live maturity proof.
-- Full financial-source dates remain relative to the server clock.

-- Owner-only, rollback-only controlled historical fixture. This is neither
-- imported Cloud data nor evidence of thirty days of production operation.
-- Preparation temporarily permits UPDATE of this test member's originals;
-- all installed triggers are restored before the actual canonical writer.
create temporary table mature_ctx(member_id uuid,admin_id uuid,job uuid,earned uuid,activation uuid,
 state uuid,shift interval,credits_before bigint);
insert into mature_ctx values('10639000-0000-4000-8000-000000000001',
 '10639000-0000-4000-8000-000000000002',null,null,null,null,interval '31 days',null);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@mature-controlled.putduk.test','',
 statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from mature_ctx cross join lateral unnest(array[member_id,admin_id]) person;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN',admin_id from mature_ctx;
select public.bootstrap_user(member_id) from mature_ctx;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant select,update on mature_ctx to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',100000,'controlled-mature-deposit'),
 admin_id,100000,'controlled-mature-credit','Synthetic local historical fixture source only',gen_random_uuid()) from mature_ctx;
set constraints all immediate;
set constraints all deferred;
reset role;
create temporary table full_chain_ctx(bank uuid,withdrawal uuid,send uuid,finalized uuid,sent_at timestamptz,
 wallet_before bigint,anchor timestamptz,cycle_end timestamptz,reconciliation_run uuid);
insert into full_chain_ctx values(null,null,null,null,null,null,null,null,null);
-- Owner-only local synthetic destination/payout policy, same zero-fee fixture
-- contract as existing native withdrawal tests. No real bank account or payment.
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,
 minimum_amount_atomic,fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','KRW_BANK',10639801,true,1,0,'{}',statement_timestamp()-interval '1 hour',admin_id,false from mature_ctx;
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,
 value_fingerprint,display_hint,verification_status,verified_at,protection_until)
select member_id,'KRW_BANK',decode(repeat('ab',32),'hex'),
 encode(extensions.digest(member_id::text||'KRW_BANK','sha256'),'hex'),'Synthetic local bank destination',
 'VERIFIED',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day' from mature_ctx;
update full_chain_ctx set bank=(select id from public.withdrawal_destinations where user_id=(select member_id from mature_ctx) and destination_type='KRW_BANK');
grant select,update on full_chain_ctx to service_role;
set local role service_role;
select throws_ok($$select public.request_krw_withdrawal((select member_id from mature_ctx),(select bank from full_chain_ctx),15000,'full-chain-before-maturity')$$,
 '55000','WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
 'approved principal and unearned conditional retention cannot fund reward withdrawal before maturity');
select is((select count(*) from public.mining_reward_credits where user_id=(select member_id from mature_ctx)),0::bigint,
 'fresh real deposit has no manufactured verified mining credit');
select is((select count(*) from public.withdrawal_requests where user_id=(select member_id from mature_ctx)),0::bigint,
 'before-maturity rejection leaves no withdrawal or hold original');
reset role;
update mature_ctx set activation=(select id from app_private.funding_engine_activations where user_id=member_id),
 state=(select id from app_private.funding_engine_state where user_id=member_id);
create temporary table mature_fixture_triggers as
select n.nspname,c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and
 ((n.nspname='app_private' and c.relname in('funding_engine_epochs','funding_engine_activations',
 'funding_condition_originals','funding_engine_state_receipts','funding_portion_transitions',
 'funding_portion_clock_receipts','funding_cycle_windows'))
 or(n.nspname='public' and c.relname in('money_source_movements','ledger_transactions','funding_principal_lots','funding_principal_revisions','audit_logs','outbox_events')));
do $$declare t record;begin
 if current_user<>'postgres' then raise exception 'OWNER_ONLY_SYNTHETIC_HISTORY';end if;
 for t in select * from mature_fixture_triggers loop
 execute format('alter table %I.%I disable trigger %I',t.nspname,t.relname,t.tgname);end loop;
end$$;
create function pg_temp.shift_controlled_input(p jsonb) returns jsonb language plpgsql as $$
declare k text;v jsonb;r jsonb;begin
 if jsonb_typeof(p)='object' then
 r:='{}';for k,v in select * from jsonb_each(p) loop
  if k in('first_credit_at_microseconds','credit_at_microseconds','effective_at_microseconds') and v#>>'{}' ~ '^[0-9]+$' then
   v:=to_jsonb(((v#>>'{}')::bigint-2678400000000)::text);
  else v:=pg_temp.shift_controlled_input(v);end if;
  r:=r||jsonb_build_object(k,v);end loop;
  if r ? 'principal_original_digest' and r ? 'credit_originals' then
   r:=r||jsonb_build_object('principal_original_digest',app_private.funding_engine_digest(r->'credit_originals'));end if;
  return r;
 elsif jsonb_typeof(p)='array' then select coalesce(jsonb_agg(pg_temp.shift_controlled_input(value)),'[]') into r from jsonb_array_elements(p);return r;
 end if;return p;end$$;
update app_private.funding_engine_epochs set introduced_at=introduced_at-interval '32 days' where version=1;
update public.money_source_movements set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update public.ledger_transactions set posted_at=posted_at-interval '31 days' where member_user_id=(select member_id from mature_ctx);
update public.funding_principal_lots set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update public.funding_principal_revisions set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_cycle_windows set cycle_started_at=cycle_started_at-interval '31 days',cycle_end=cycle_end-interval '31 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_clock_receipts set effective_at=effective_at-interval '31 days',resumed_at=resumed_at-interval '31 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set effective_at=effective_at-interval '31 days',
 input_original=pg_temp.shift_controlled_input(input_original) where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set input_digest=app_private.funding_engine_digest(input_original)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals set effective_at=effective_at-interval '31 days',inputs=pg_temp.shift_controlled_input(inputs)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals c set input_digest=app_private.funding_engine_digest(app_private.funding_condition_snapshot(c))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions t set input_digest=app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(t))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_state_receipts set cursor_at=cursor_at-interval '31 days' where user_id=(select member_id from mature_ctx);
with originals as(
 select id,audit_id,source_event_id,input_digest,app_private.funding_activation_snapshot(a) snapshot from app_private.funding_engine_activations a where user_id=(select member_id from mature_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_condition_snapshot(c) from app_private.funding_condition_originals c where user_id=(select member_id from mature_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_portion_transition_snapshot(t) from app_private.funding_portion_transitions t where user_id=(select member_id from mature_ctx))
update public.audit_logs a set after_state=o.snapshot,metadata=a.metadata||jsonb_build_object('input_digest',o.input_digest,
 'fixture_provenance','OWNER_ONLY_CONTROLLED_HISTORY_ROLLBACK') from originals o where a.id=o.audit_id;
with originals as(
 select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_engine_activations where user_id=(select member_id from mature_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_condition_originals where user_id=(select member_id from mature_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_portion_transitions where user_id=(select member_id from mature_ctx))
update public.outbox_events e set payload=jsonb_build_object('user_id',o.user_id,'audit_id',o.audit_id,'input_digest',o.input_digest)
 from originals o where e.id=o.source_event_id;
set constraints all immediate;
set constraints all deferred;
do $$declare t record;begin for t in select * from mature_fixture_triggers loop
 execute format('alter table %I.%I %s trigger %I',t.nspname,t.relname,
 case t.tgenabled when 'O' then 'enable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'disable' end,t.tgname);
end loop;end$$;
select ok(not exists(select 1 from mature_fixture_triggers f join pg_namespace n on n.nspname=f.nspname
 join pg_class c on c.relnamespace=n.oid and c.relname=f.relname join pg_trigger t on t.tgrelid=c.oid and t.tgname=f.tgname
 where t.tgenabled<>f.tgenabled),'all installed source and integrity guards restored before canonical completion');
set local role service_role;
select lives_ok($$select app_private.read_cycle_retention_components(s.id,c.cycle_end) from app_private.funding_engine_state s
 join app_private.funding_cycle_windows c on c.id=s.cycle_id where s.user_id=(select member_id from mature_ctx)$$,
 'controlled mature history passes source-seal and portion-clock reconstruction');
update mature_ctx set job=app_private.prepare_default_funding_job(activation),credits_before=(select count(*) from public.mining_reward_credits);
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from mature_ctx);
set local role service_role;
select id from public.claim_system_jobs('controlled-mature-worker',1,300);
reset role;
create function pg_temp.inject_rollover_fault() returns trigger language plpgsql as $$begin
 if new.user_id=(select member_id from mature_ctx) then raise exception 'LOCAL_ROLLOVER_FAULT';end if;return new;end$$;
create trigger local_rollover_fault before insert on app_private.funded_mining_mission_originals for each row execute function pg_temp.inject_rollover_fault();
set local role service_role;
select throws_like($$select public.complete_system_job(job,'controlled-mature-worker') from mature_ctx$$,
 'LOCAL_ROLLOVER_FAULT','mission-original fault rejects the entire canonical terminal transaction');
select is((select count(*) from public.mining_reward_credits),(select credits_before from mature_ctx),
 'next-window fault rolls back the wallet credit rather than leaving a paid closed cycle');
select is((select count(*) from app_private.funding_earned_receipts where job_id=(select job from mature_ctx)),0::bigint,
 'next-window fault rolls back the earned receipt');
reset role;
drop trigger local_rollover_fault on app_private.funded_mining_mission_originals;
create function pg_temp.full_chain_stop(p_paused boolean,p_key text)
returns void language plpgsql security invoker set search_path=pg_catalog as $stop$
begin
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 select admin_id,'ADMIN',case when p_paused then 'SAFE_MODE_ENABLED' else 'SAFE_MODE_DISABLED' end,
 'SAFE_MODE','NEW_MINING','Synthetic local full-chain safe-mode verification',gen_random_uuid(),
 jsonb_build_object('command_version',1,'idempotency_key',p_key,'component','NEW_MINING',
 'is_paused',p_paused,'review_at',null,'expected_request_id',
 (select request_id from public.safe_mode_controls where component='NEW_MINING')) from pg_temp.mature_ctx;
end;$stop$;
grant execute on function pg_temp.full_chain_stop(boolean,text) to service_role;
set local role service_role;
select pg_temp.full_chain_stop(true,'full-chain-pause');
select throws_ok($$select public.complete_system_job(job,'controlled-mature-worker') from mature_ctx$$,
 '55000','SAFE_MODE_ACTIVE','safe mode committed after actual claim blocks canonical earning');
select is((select count(*) from public.mining_reward_credits),(select credits_before from mature_ctx),
 'safe-mode rejected completion leaves no verified reward credit');
select is((select count(*) from app_private.funding_earned_receipts where job_id=(select job from mature_ctx)),0::bigint,
 'safe-mode rejected completion leaves no earned original');
select pg_temp.full_chain_stop(false,'full-chain-resume');
set local time zone 'UTC';
set local role service_role;
select lives_ok($$select public.complete_system_job(job,'controlled-mature-worker') from mature_ctx$$,
 'actual installed canonical worker writer settles controlled thirty-day maturity');
update mature_ctx set earned=(select id from app_private.funding_earned_receipts where job_id=job);
select is((select amount_atomic from app_private.funding_earned_receipts where id=(select earned from mature_ctx)),15000::bigint,
 'approved 15 percent retention pays exactly 15000 on a synthetic 100000 source and zero allocation');
select is((select count(*) from public.mining_reward_credits),(select credits_before+1 from mature_ctx),
 'terminal retention creates one authoritative wallet-linked reward credit');
select ok((select cycle_closed from app_private.funding_engine_state_receipts where id=(select next_state_id from app_private.funding_earned_receipts where id=(select earned from mature_ctx))),
 'terminal state closes at the exact original fixed cycle end');
select ok((select component_original is not null from app_private.funding_retention_qualifications where earned_receipt_id=(select earned from mature_ctx)),
 'terminal payment stores exact source and eligible-time component evidence');
select lives_ok($$set constraints all immediate$$,'real service role deferred seals and balanced source invariants accept terminal payment');
set constraints all deferred;
select lives_ok($$select public.complete_system_job(job,'controlled-mature-worker') from mature_ctx$$,'response-loss retry replays terminal receipt');
select is((select count(*) from public.mining_reward_credits),(select credits_before+1 from mature_ctx),'terminal replay creates no second credit');
select ok((select not s.cycle_closed and s.cursor_at=old.cycle_end and c.cycle_started_at=old.cycle_end and c.cycle_end=old.cycle_end+30*interval '24 hours'
 from app_private.funding_engine_state s join app_private.funding_cycle_windows c on c.id=s.cycle_id
 join app_private.funding_cycle_windows old on old.user_id=s.user_id and old.cycle_ordinal=0 where s.user_id=(select member_id from mature_ctx)),
 'canonical terminal completion atomically opens the next fixed window with no gap');
select is((select count(*) from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx)),1::bigint,
 'terminal retry does not repeat cycle rollover');
select throws_like($$update public.outbox_events set payload='{}' where id=(select source_event_id from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx))$$,
 'FUNDING_ROLLOVER_ENVELOPE_IMMUTABLE','rollover source event payload cannot be rewritten by service');
select throws_like($$update public.audit_logs set metadata='{}' where id=(select audit_id from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx))$$,
 'permission denied for table audit_logs','service has no UPDATE grant on the rollover audit original');
reset role;
select throws_like($$update public.audit_logs set metadata='{}' where id=(select audit_id from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx))$$,
 '%append-only%','even the native owner cannot rewrite a sealed rollover audit with guards enabled');
set local role service_role;
select ok((select s.base_used_num=0 and s.retention_used_num=0 and s.carry_num=(e.calculation->>'carryNum')::numeric and s.carry_den=(e.calculation->>'carryDen')::numeric
 from app_private.funding_engine_state s join app_private.funding_earned_receipts e on e.id=(select earned from mature_ctx)
 where s.user_id=(select member_id from mature_ctx)), 'new cycle resets used capacities and preserves only exact carry');


-- This withdrawal consumes the actual canonical terminal earned.credit_id.
-- No ledger CREDIT, mining_reward_credit or source CREDIT is planted here.
update full_chain_ctx set anchor=(select cycle_started_at from app_private.funding_cycle_windows where user_id=(select member_id from mature_ctx) and cycle_ordinal=0),
 cycle_end=(select cycle_end from app_private.funding_cycle_windows where user_id=(select member_id from mature_ctx) and cycle_ordinal=0);
update full_chain_ctx set wallet_before=(select coalesce(sum(case when direction='CREDIT' then amount_atomic else -amount_atomic end),0)::bigint from public.wallet_ledger where user_id=(select member_id from mature_ctx));
select throws_ok($$select public.request_krw_withdrawal((select member_id from mature_ctx),(select bank from full_chain_ctx),115001,'full-chain-over-wallet')$$,
 '22003','INSUFFICIENT_AVAILABLE_BALANCE','a request beyond the actual wallet balance is rejected');
update full_chain_ctx set withdrawal=public.request_krw_withdrawal((select member_id from mature_ctx),bank,
 (select amount_atomic from app_private.funding_earned_receipts where id=(select earned from mature_ctx)),'full-chain-earned-hold');
select is(public.request_krw_withdrawal((select member_id from mature_ctx),(select bank from full_chain_ctx),15000,'full-chain-earned-hold'),
 (select withdrawal from full_chain_ctx),'response-loss retry recovers the same reward hold');
select ok((select count(*)=1 and sum(r.amount_atomic)=15000 and bool_and(m.source_bucket='MINING_REWARD' and m.movement_kind='CREDIT')
 and bool_and(m.wallet_ledger_id=c.wallet_ledger_id and m.ledger_transaction_id=c.ledger_transaction_id)
 from public.mining_reward_withdrawal_reservations r join public.money_source_movements m on m.id=r.credit_movement_id
 join public.mining_reward_credits c on c.id=(select credit_id from app_private.funding_earned_receipts where id=(select earned from mature_ctx))
 where r.hold_ledger_transaction_id=(select hold_ledger_transaction_id from public.withdrawal_requests where id=(select withdrawal from full_chain_ctx))),
 'hold reserves exactly the installed canonical writer earned credit and its original wallet/journal');
select is((select count(*) from public.funding_principal_recovery_allocations where user_id=(select member_id from mature_ctx)),0::bigint,
 'reward withdrawal never reserves or recovers principal');
select throws_ok($$select public.record_krw_external_send((select withdrawal from full_chain_ctx),'FULL-CHAIN-UNDERPAY',14999,
 (select admin_id from mature_ctx),clock_timestamp(),'full-chain-underpay-rejected')$$,
 '22023','KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST','partial manual transfer cannot be recorded as a full requested payout');
select throws_ok($$select public.record_krw_external_send((select withdrawal from full_chain_ctx),'FULL-CHAIN-OVERPAY',15001,
 (select admin_id from mature_ctx),clock_timestamp(),'full-chain-overpay-rejected')$$,
 '22023','KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST','overpayment cannot be recorded as the requested payout');
select is((select count(*) from public.withdrawal_external_sends where withdrawal_id=(select withdrawal from full_chain_ctx)),0::bigint,
 'rejected amount mismatches leave no irreversible send receipt');
select is((select status::text from public.withdrawal_requests where id=(select withdrawal from full_chain_ctx)),'HELD',
 'mismatched send attempts retain the pending original reward hold');
update full_chain_ctx set sent_at=clock_timestamp();
update full_chain_ctx set send=public.record_krw_external_send(withdrawal,'FULL-CHAIN-SYNTHETIC-BANK-RECEIPT',15000,
 (select admin_id from mature_ctx),sent_at,'full-chain-earned-send');
select is(public.record_krw_external_send((select withdrawal from full_chain_ctx),'FULL-CHAIN-SYNTHETIC-BANK-RECEIPT',15000,
 (select admin_id from mature_ctx),(select sent_at from full_chain_ctx),'full-chain-earned-send'),(select send from full_chain_ctx),
 'lost send response replays exact transfer facts without another send');
select throws_ok($$select public.release_withdrawal_hold((select withdrawal from full_chain_ctx),(select admin_id from mature_ctx),'late release attempt','full-chain-late-release','CANCELLED')$$,
 '55000','WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND','external sent reward hold cannot be cancelled and restored');
update full_chain_ctx set finalized=public.finalize_withdrawal_ledger(withdrawal,(select admin_id from mature_ctx),'full-chain-earned-finalize');
select is(public.finalize_withdrawal_ledger((select withdrawal from full_chain_ctx),(select admin_id from mature_ctx),'full-chain-earned-finalize'),
 (select finalized from full_chain_ctx),'lost finalize response recovers original debit journal');
select lives_ok($$set constraints all immediate$$,'actual deposit-to-earned-to-withdrawal chain passes all installed deferred seals and balanced journals');
reset role;
select is((select status::text from public.withdrawal_requests where id=(select withdrawal from full_chain_ctx)),'COMPLETED',
 'same original canonical earned reward reaches native completed withdrawal');
select is((select count(*) from public.withdrawal_external_sends where withdrawal_id=(select withdrawal from full_chain_ctx)),1::bigint,
 'end-to-end retries preserve one external send evidence');
select is((select count(*) from public.wallet_ledger where reference_id=(select withdrawal from full_chain_ctx) and entry_type='WITHDRAWAL' and direction='DEBIT'),1::bigint,
 'end-to-end retries debit the real wallet exactly once');
select is((select coalesce(sum(case when direction='CREDIT' then amount_atomic else -amount_atomic end),0)::bigint from public.wallet_ledger where user_id=(select member_id from mature_ctx)),
 (select wallet_before-15000 from full_chain_ctx),'wallet net decreases by actual verified earned payout amount once');
select is((select eligible_principal_atomic from public.money_source_summaries where user_id=(select member_id from mature_ctx)),'100000',
 'reward payout preserves the entire confirmed eligible principal');
select is((select coverage from public.money_source_summaries where user_id=(select member_id from mature_ctx)),'COMPLETE',
 'full chain retains verified money-source coverage');
select ok(not exists(select 1 from public.ledger_entries e join public.ledger_transactions t on t.id=e.transaction_id
 where t.member_user_id=(select member_id from mature_ctx) group by e.transaction_id
 having sum(case when e.side='DEBIT' then e.amount_atomic else -e.amount_atomic end)<>0),
 'every member journal in the actual chain balances debit against credit');
select ok((select c.cycle_started_at=f.anchor and c.cycle_end=f.cycle_end from app_private.funding_cycle_windows c
 cross join full_chain_ctx f where c.user_id=(select member_id from mature_ctx) and c.cycle_ordinal=0),
 'reward withdrawal/finalize never resets the original mining cycle');
set local role service_role;
update full_chain_ctx set reconciliation_run=public.run_financial_reconciliation('10639800-0000-4000-8000-000000000001');
select lives_ok($$set constraints all immediate$$,'canonical reconciliation finishes after verified end-to-end payout');
reset role;
select ok((select reconciliation_run is not null from full_chain_ctx),'actual reconciliation produced a recorded run');
select is((select count(*) from public.reconciliation_mismatches where run_id=(select reconciliation_run from full_chain_ctx)
 and mismatch_type='KRW_WALLET_LIABILITY_HOLD_PARITY'),0::bigint,
 'completed chain has no wallet/liability/hold parity mismatch');
select * from finish();
rollback;
