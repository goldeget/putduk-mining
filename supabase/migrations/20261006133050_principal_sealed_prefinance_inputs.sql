begin;

-- Exact closed130 admission proof before its journal exists. Native/deferred
-- completion still requires the complete130 journal and source. This function
-- is not callable by service/member and is only a private constructor input.
create function app_private.assert_principal_admission_before_finance(p_admission uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype; original_hold app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 perform app_private.assert_principal_input_executor(admission.user_id);
 select r.* into request from public.withdrawal_requests r where r.id=admission.withdrawal_id;
 if admission.id is null or request.user_id is distinct from admission.user_id
  or request.currency<>'KRW' or request.fee_atomic<>0 or request.welcome_reward_conversion_id is not null
  or admission.amount_atomic is distinct from request.amount_atomic
  or admission.request_snapshot is distinct from app_private.funding_withdrawal_request_snapshot(request)
  or admission.effective_at>clock_timestamp()
  or admission.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_withdrawal_clock_snapshot(admission))
  or not exists(select 1 from public.audit_logs a where a.id=admission.audit_id and a.actor_user_id=admission.user_id
    and a.request_id=admission.journal_request_id and a.created_at=admission.effective_at)
  or not exists(select 1 from public.outbox_events e where e.id=admission.source_event_id
    and e.request_id=admission.journal_request_id and e.correlation_id=admission.journal_request_id
    and e.occurred_at=admission.effective_at and e.created_at=admission.effective_at)
  or exists(select 1 from public.ledger_transactions t where t.metadata->>'clock_admission_id'=admission.id::text)
  or(admission.phase='HOLD' and(request.status<>'REQUESTED' or request.hold_ledger_transaction_id is not null
    or admission.hold_admission_id is not null))
  or(admission.phase='RELEASE' and(request.status not in('HELD','ADMIN_PROCESSING','REVIEWING','APPROVED','PROCESSING')
    or request.release_ledger_transaction_id is not null or request.finalize_ledger_transaction_id is not null)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREFINANCE_ADMISSION_REQUIRED'; end if;
 perform app_private.assert_funding_engine_seal(admission.id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED',admission.user_id,
  admission.input_digest,admission.audit_id,admission.source_event_id,app_private.funding_withdrawal_clock_snapshot(admission));
 if admission.phase='RELEASE' then
  select a.* into original_hold from app_private.funding_withdrawal_clock_admissions a where a.id=admission.hold_admission_id;
  if original_hold.phase is distinct from 'HOLD' or original_hold.user_id is distinct from admission.user_id
   or original_hold.withdrawal_id is distinct from admission.withdrawal_id or original_hold.effective_at>admission.effective_at then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RELEASE_PREDECESSOR_REQUIRED'; end if;
  perform app_private.assert_funding_withdrawal_clock_completion(original_hold.id);
 end if;
end;
$$;

create function app_private.principal_boundary_prefinance_coverage_verified(p_user uuid,p_withdrawal uuid,p_admission uuid)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare request public.withdrawal_requests%rowtype; summary public.money_source_summaries%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role'
   or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='PRINCIPAL_INTENT_INPUT_PRODUCER_REQUIRED'; end if;
 perform app_private.assert_principal_admission_before_finance(p_admission);
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal and r.user_id=p_user;
 if not exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission and a.phase='HOLD' and a.withdrawal_id=request.id and a.user_id=p_user)
  or request.id is null or request.status<>'REQUESTED' or request.currency<>'KRW' or request.fee_atomic<>0
  or request.welcome_reward_conversion_id is not null or request.hold_ledger_transaction_id is not null
  or request.release_ledger_transaction_id is not null or request.finalize_ledger_transaction_id is not null
  or not exists(select 1 from public.wallet_accounts w where w.id=request.wallet_account_id
    and w.user_id=p_user and w.currency='KRW' and w.closed_at is null)
  or exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=request.id and a.id<>p_admission)
  or exists(select 1 from public.ledger_transactions t where (t.reference_type='withdrawal_request' and t.reference_id=request.id)
    or t.idempotency_key=request.idempotency_key||':hold')
  or exists(select 1 from public.wallet_ledger l where l.reference_type='withdrawal_request' and l.reference_id=request.id)
  or exists(select 1 from public.transaction_receipts r where r.source_type='withdrawal_request' and r.source_id=request.id)
  or exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=request.id) then return false;end if;
 select s.* into summary from public.money_source_summaries s where s.user_id=p_user;
 if summary.user_id is null or summary.schema_version<>2
  or summary.unclassified_wallet_entries is distinct from '0'
  or summary.unclassified_journals is distinct from '0'
  or summary.invalid_source_receipts is distinct from '0'
  or summary.unconnected_withdrawals is distinct from '1' then return false;end if;
 -- Identical classification predicate to the current source view, except the
 -- single exactly validated request above. No arbitrary count subtraction.
 if exists(select 1 from public.withdrawal_requests r where r.user_id=p_user and r.currency='KRW'
  and r.id<>request.id and not app_private.non_principal_withdrawal_coverage_verified(r)
  and not exists(select 1 from public.funding_principal_recovery_allocations a
    where a.user_id=r.user_id and a.hold_ledger_transaction_id=r.hold_ledger_transaction_id)) then return false;end if;
 return true;
end;
$$;

create function app_private.read_principal_boundary_current_inputs(p_user uuid,p_allocation uuid,p_at timestamptz,p_withdrawal uuid,p_admission uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare movement public.money_source_movements%rowtype; principal public.funding_principal_revisions%rowtype;
 policy app_private.economy_policy_published%rowtype; receipt app_private.economy_policy_receipts%rowtype;
 policy_revision integer:=0; previous uuid; tier jsonb; allocation_bps integer:=0;
 cumulative_micro numeric:=0; first_credit_at timestamptz; manifest jsonb:='[]'::jsonb;
 source record; source_count bigint; credits bigint; role_name text;
begin
 role_name:=current_setting('role',true);
 if p_user is null or current_user<>'postgres' or role_name is distinct from 'service_role'
   or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_INPUT_SUBJECT_FORBIDDEN'; end if;
 if p_at is null or not isfinite(p_at) or p_at>clock_timestamp()
   or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 if p_at is distinct from(select a.effective_at from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission and a.user_id=p_user and a.withdrawal_id=p_withdrawal) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT_CLOCK_MISMATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 if not app_private.principal_boundary_prefinance_coverage_verified(p_user,p_withdrawal,p_admission)
  or exists(select 1 from public.funding_principal_recovery_allocations where user_id=p_user)
  or exists(select 1 from public.funding_principal_recovery_releases where user_id=p_user)
  or exists(select 1 from app_private.funding_cycle_segments where user_id=p_user)
  or exists(select 1 from public.money_source_movements where user_id=p_user and source_bucket='PRINCIPAL'
    and(movement_kind<>'CREDIT' or origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT'))) then
  raise exception using errcode='55000',message='FUNDING_SOURCE_BOUNDARY_ADAPTER_REQUIRED'; end if;
 select count(*) into credits from public.money_source_movements where user_id=p_user and source_bucket='PRINCIPAL';
 if credits=0 or credits<>(select count(*) from public.funding_principal_lots where user_id=p_user)
  or credits<>(select count(*) from public.funding_principal_revisions where user_id=p_user) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
 -- Positive INCREASE snapshots establish their immutable logical order by net
 -- after balance, not guessed wall-clock/UUID tie order. Every exact delta must
 -- connect to the next receipt; neither a stale gross chain nor hidden hold is
 -- repaired here. No monetary original is inserted by this reader.
 for source in select m.id as movement_id,l.id as lot_id,r.id as principal_revision_id
   from public.funding_principal_revisions r
   join public.funding_principal_lots l on l.id=r.lot_id
   join public.money_source_movements m on m.id=r.money_source_movement_id
   where r.user_id=p_user order by r.eligible_principal_micro_krw_after loop
  select * into movement from public.money_source_movements where id=source.movement_id;
  select * into principal from public.funding_principal_revisions where id=source.principal_revision_id;
  if movement.user_id is distinct from p_user or movement.effective_at>p_at
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or principal.direction is distinct from 'INCREASE' or principal.user_id is distinct from p_user
   or principal.effective_at is distinct from movement.effective_at
   or principal.ledger_transaction_id is distinct from movement.ledger_transaction_id
   or principal.source_event_id is distinct from movement.source_event_id
   or principal.delta_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
   or principal.eligible_principal_micro_krw_after::numeric is distinct from cumulative_micro+principal.delta_micro_krw
   or not exists(select 1 from public.funding_principal_lots l where l.id=source.lot_id and l.user_id=p_user
    and l.money_source_movement_id=movement.id and l.ledger_transaction_id=movement.ledger_transaction_id
    and l.source_event_id=movement.source_event_id and l.effective_at=movement.effective_at
    and l.amount_atomic=movement.amount_atomic and l.amount_micro_krw=principal.delta_micro_krw) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
  perform app_private.assert_money_source_credit(movement);
  cumulative_micro:=cumulative_micro+principal.delta_micro_krw;
  first_credit_at:=least(first_credit_at,movement.effective_at);
  manifest:=manifest||jsonb_build_array(jsonb_build_object('credit_id',movement.id,'lot_id',source.lot_id,
   'principal_revision_id',principal.id,'amount_atomic',movement.amount_atomic::text,
   'effective_at_microseconds',((extract(epoch from movement.effective_at)*1000000)::bigint)::text));
 end loop;
 select count(*) into source_count from jsonb_array_elements(manifest);
 if source_count<>credits or cumulative_micro is distinct from app_private.funding_principal_mining_eligible_micro(p_user,clock_timestamp())
   or cumulative_micro>9223372036854775807 then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
 -- Only this local calculation record uses the derived aggregate for tier and
 -- policy checks. Its real credit was independently verified before aggregation.
 movement.amount_atomic:=div(cumulative_micro,1000000)::bigint;
 -- Validate the real policy publication chain directly in the trusted member
 -- definer context, without impersonating the service-only policy RPC role.
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy',0));
 select * into policy from app_private.economy_policy_published where effective_from<=p_at
  and(effective_until is null or effective_until>p_at);
 if policy.policy_id is null then raise exception using errcode='55000',message='FUNDING_POLICY_ORIGINAL_REQUIRED'; end if;
 perform app_private.validate_economy_policy_config(policy.config);
 for receipt in select * from app_private.economy_policy_receipts where policy_id=policy.policy_id order by revision loop
  policy_revision:=policy_revision+1;
  if receipt.revision is distinct from policy_revision or policy_revision>4 or receipt.previous_revision_id is distinct from previous
   or receipt.state is distinct from (array['DRAFT','PREVIEWED','APPROVED','PUBLISHED'])[policy_revision] then
   raise exception using errcode='55000',message='FUNDING_POLICY_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_economy_policy_receipt(receipt.id); previous:=receipt.id;
 end loop;
 if policy_revision<>4 or previous is distinct from policy.revision_id
  or policy.config#>>'{platformFeesKrw,mining}' is distinct from '0'
  or policy.config#>>'{productMultiplier,defaultBps}' is distinct from '10000'
  or policy.config#>>'{userOverride,defaultMultiplierBps}' is distinct from '10000'
  or policy.config#>>'{campaign,defaultSpeedMultiplierBps}' is distinct from '10000'
  or policy.config#>>'{campaign,defaultCapacityBoostBps}' is distinct from '0'
  or policy.config#>>'{allocation,capacityScope}' is distinct from 'GLOBAL_CYCLE' then
  raise exception using errcode='55000',message='FUNDING_DEFAULT_POLICY_REQUIRED'; end if;
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::bigint<=movement.amount_atomic
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::bigint>=movement.amount_atomic);
 if tier is null and movement.amount_atomic>=(policy.config->>'minimumPrincipalKrw')::bigint then
  raise exception using errcode='55000',message='FUNDING_TIER_UNRESOLVED'; end if;
 if p_allocation is not null then
  allocation_bps:=app_private.assert_prospective_allocation(p_allocation,p_user,policy.config,coalesce((tier->>'slots')::integer,0));
  if (select effective_at from app_private.funding_allocation_originals where id=p_allocation)>p_at then
   raise exception using errcode='55000',message='FUNDING_ALLOCATION_FUTURE_INPUT'; end if;
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 if exists(select 1 from public.safe_mode_controls where component in('NEW_MINING','SETTLEMENT')
   and(is_paused or starts_at>=first_credit_at))
  or exists(select 1 from public.audit_logs where target_type='SAFE_MODE' and target_id in('NEW_MINING','SETTLEMENT')
   and(after_state->>'starts_at')::timestamptz>=first_credit_at)
  or exists(select 1 from public.block_rules where user_id=p_user and scope='ACCOUNT'
   and(ends_at is null or ends_at>first_credit_at)) then
  raise exception using errcode='55000',message='FUNDING_CONTROL_BOUNDARY_ADAPTER_REQUIRED'; end if;
 -- GLOBAL history requires exact immutable command originals, never a guessed state.
 perform app_private.funding_global_eligible_interval(first_credit_at,p_at);
 return jsonb_build_object('input_contract_version',2,'user_id',p_user,'credit_originals',manifest,
  'principal_original_digest',app_private.funding_engine_digest(manifest),
  'principal_atomic',movement.amount_atomic::text,'first_credit_at_microseconds',((extract(epoch from first_credit_at)*1000000)::bigint)::text,
  'allocation_id',p_allocation,'allocation_digest',(select input_digest from app_private.funding_allocation_originals where id=p_allocation),
  'allocation_bps',allocation_bps,'policy_publication_id',policy.publication_id,'policy_config_digest',policy.config_digest,
  'policy_effective_from_microseconds',((extract(epoch from policy.effective_from)*1000000)::bigint)::text,
  'cycle_days',(policy.config->>'cycleDays')::integer,'base_bps',(policy.config->>'baseCycleRateBps')::integer,
  'retention_bps',coalesce((tier->>'retentionBonusBps')::integer,0),'tier_code',tier->>'code',
  'slots',coalesce((tier->>'slots')::integer,0),'tier_activated',tier is not null);
end;
$$;

create function app_private.assert_principal_boundary_prefinance_portion_transition(p_transition app_private.funding_portion_transitions,p_withdrawal uuid,p_admission uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 movement public.money_source_movements%rowtype;
begin
 if current_user is distinct from 'postgres' or current_setting('role',true) is distinct from 'service_role'
  or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='PRINCIPAL_INTENT_PORTION_PRODUCER_REQUIRED'; end if;
 -- This first verified input2 preparation supports historical CREDIT portions
 -- only. Future HOLD/RELEASE input3 needs a distinct fully bound adapter.
 if p_transition.kind is distinct from 'CREDIT'
  or not exists(select 1 from app_private.funding_portion_transitions t where t.id=p_transition.id
    and to_jsonb(t)=to_jsonb(p_transition)) then
  raise exception using errcode='55000',message='PRINCIPAL_INTENT_PREFINANCE_PORTION_ORIGINAL_REQUIRED'; end if;
 if p_transition.effective_at>clock_timestamp() then raise exception using errcode='55000',message='FUNDING_PORTION_FUTURE_ORIGINAL'; end if;
 if p_transition.kind='CREDIT' then
  select * into lot from public.funding_principal_lots where id=p_transition.original_id;
  select * into movement from public.money_source_movements where id=lot.money_source_movement_id;
  if lot.user_id is distinct from p_transition.user_id or lot.effective_at is distinct from p_transition.effective_at
   or movement.user_id is distinct from lot.user_id or movement.source_bucket is distinct from 'PRINCIPAL'
   or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or not exists(select 1 from app_private.funding_engine_activations where user_id=lot.user_id and runtime_version=2)
   then
   raise exception using errcode='55000',message='FUNDING_PORTION_FRESH_LOT_REQUIRED'; end if;
  perform app_private.assert_money_source_credit(movement);
 elsif p_transition.kind='HOLD' then
  select * into allocation from public.funding_principal_recovery_allocations where id=p_transition.original_id;
  select * into movement from public.money_source_movements where ledger_transaction_id=allocation.hold_ledger_transaction_id
   and origin_code='PRINCIPAL_RECOVERY_HOLD';
  if allocation.user_id is distinct from p_transition.user_id or allocation.policy_code is distinct from 'NEWEST_FIRST'
   or allocation.effective_at is distinct from p_transition.effective_at or movement.user_id is distinct from allocation.user_id then
   raise exception using errcode='55000',message='FUNDING_PORTION_HOLD_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_principal_recovery_movement(movement);
 elsif p_transition.kind='RELEASE' then
  select * into release from public.funding_principal_recovery_releases where id=p_transition.original_id;
  select * into movement from public.money_source_movements where ledger_transaction_id=release.release_ledger_transaction_id
   and origin_code='PRINCIPAL_RECOVERY_RELEASE';
  if release.user_id is distinct from p_transition.user_id or release.effective_at is distinct from p_transition.effective_at
   or movement.user_id is distinct from release.user_id then
   raise exception using errcode='55000',message='FUNDING_PORTION_RELEASE_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_principal_recovery_movement(movement);
 elsif p_transition.kind='FINALIZE' then
  select * into request from public.withdrawal_requests where id=p_transition.original_id;
  select * into movement from public.money_source_movements where ledger_transaction_id=request.finalize_ledger_transaction_id
   and origin_code='PRINCIPAL_RECOVERY_FINALIZE';
  if request.user_id is distinct from p_transition.user_id or request.status<>'COMPLETED' or request.fee_atomic<>0
   or request.currency<>'KRW' or request.finalize_ledger_transaction_id is null
   or movement.user_id is distinct from request.user_id or movement.amount_atomic is distinct from request.amount_atomic
   or not exists(select 1 from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=request.hold_ledger_transaction_id)
   or not exists(select 1 from public.withdrawal_external_sends where withdrawal_id=request.id)
   or not app_private.withdrawal_coverage_entries_verified(request.finalize_ledger_transaction_id,request.user_id,request.amount_atomic,'FINALIZE')
   or p_transition.effective_at is distinct from(select posted_at from public.ledger_transactions where id=request.finalize_ledger_transaction_id) then
   raise exception using errcode='55000',message='FUNDING_PORTION_FINALIZE_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_principal_recovery_movement(movement);
 else raise exception using errcode='55000',message='FUNDING_PORTION_TRANSITION_KIND_INVALID';
 end if;
 if not app_private.principal_boundary_prefinance_coverage_verified(p_transition.user_id,p_withdrawal,p_admission) then
  raise exception using errcode='55000',message='FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED'; end if;
end;
$$;

create function app_private.verify_principal_boundary_prefinance_portion_fact(p_transition app_private.funding_portion_transitions,p_withdrawal uuid,p_admission uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 candidate record; expected jsonb:='[]'::jsonb; actual jsonb; left_micro bigint; take_micro bigint; amount_micro bigint;
begin
 perform app_private.assert_principal_boundary_prefinance_portion_transition(p_transition,p_withdrawal,p_admission);
 if p_transition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(p_transition)) then
  raise exception using errcode='55000',message='FUNDING_PORTION_TRANSITION_DIGEST_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(p_transition.id,'FUNDING_PORTION_CLOCK_CHANGED',p_transition.user_id,p_transition.input_digest,
  p_transition.audit_id,p_transition.source_event_id,app_private.funding_portion_transition_snapshot(p_transition));
 if p_transition.kind='CREDIT' then
  if not exists(select 1 from app_private.funding_principal_portions p join app_private.funding_portion_clock_receipts c
   on c.portion_id=p.id where p.introduced_by_transition_id=p_transition.id and p.parent_portion_id is null
   and c.transition_id=p_transition.id and c.revision=0)
   or(select count(*) from app_private.funding_principal_portions where introduced_by_transition_id=p_transition.id)<>1
   or(select count(*) from app_private.funding_portion_clock_receipts where transition_id=p_transition.id)<>1 then
   raise exception using errcode='55000',message='FUNDING_PORTION_INITIAL_CLOCK_MISSING'; end if;
 elsif p_transition.kind='HOLD' then
  select * into allocation from public.funding_principal_recovery_allocations where id=p_transition.original_id;
  perform app_private.assert_funding_portion_lot_order(allocation.hold_ledger_transaction_id);
  left_micro:=allocation.allocation_micro_krw;
  -- Reconstruct only the immediately preceding immutable clock, never a guessed
  -- present-day age. Source order and same-lot shortest-age order are distinct.
  for candidate in
   select p.id,p.amount_micro_krw,
    app_private.funding_portion_eligible_age(c.accumulated_eligible_microseconds,c.resumed_at,p_transition.effective_at,true) as age
   from app_private.funding_principal_portions p
   join lateral(select * from app_private.funding_portion_clock_receipts old_clock
    join app_private.funding_portion_transitions old_transition on old_transition.id=old_clock.transition_id
    where old_clock.portion_id=p.id and old_transition.revision<p_transition.revision
    order by old_clock.revision desc limit 1)c on true
   where p.lot_id=allocation.lot_id and c.status='AVAILABLE'
   order by age,p.id
  loop
   take_micro:=least(left_micro,candidate.amount_micro_krw);
   if take_micro=0 then exit; end if;
   expected:=expected||jsonb_build_array(jsonb_build_object('portion_id',candidate.id,'amount_micro_krw',take_micro::text));
   left_micro:=left_micro-take_micro;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('portion_id',p.id,'amount_micro_krw',
   case when c.status='HELD' then p.amount_micro_krw::text else
    (select sum(child.amount_micro_krw)::bigint::text from app_private.funding_principal_portions child
     join app_private.funding_portion_clock_receipts child_clock on child_clock.portion_id=child.id
     where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id and child_clock.transition_id=p_transition.id and child_clock.status='HELD') end)
    order by c.accumulated_eligible_microseconds,p.id),'[]') into actual
  from app_private.funding_portion_clock_receipts c join app_private.funding_principal_portions p on p.id=c.portion_id
  where c.transition_id=p_transition.id and c.revision>0 and c.status in('HELD','SPLIT');
  if left_micro<>0 or actual is distinct from expected then
   raise exception using errcode='55000',message='FUNDING_PORTION_SHORTEST_AGE_ORDER_REQUIRED'; end if;
  if exists(select 1 from app_private.funding_portion_clock_receipts c join app_private.funding_principal_portions p on p.id=c.portion_id
   where c.transition_id=p_transition.id and c.status='SPLIT' and
    ((select count(*) from app_private.funding_principal_portions child where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id)<>2
     or(select sum(child.amount_micro_krw) from app_private.funding_principal_portions child where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id)<>p.amount_micro_krw
     or(select count(*) from app_private.funding_principal_portions child join app_private.funding_portion_clock_receipts cc on cc.portion_id=child.id
       where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id and cc.transition_id=p_transition.id and cc.status='HELD')<>1
     or(select count(*) from app_private.funding_principal_portions child join app_private.funding_portion_clock_receipts cc on cc.portion_id=child.id
       where child.parent_portion_id=p.id and child.introduced_by_transition_id=p_transition.id and cc.transition_id=p_transition.id and cc.status='AVAILABLE')<>1)) then
   raise exception using errcode='55000',message='FUNDING_PORTION_SPLIT_CONSERVATION_REQUIRED'; end if;
 elsif p_transition.kind='RELEASE' then
  select * into release from public.funding_principal_recovery_releases where id=p_transition.original_id;
  select sum(allocation_micro_krw) into amount_micro from public.funding_principal_recovery_allocations
   where hold_ledger_transaction_id=release.hold_ledger_transaction_id and user_id=p_transition.user_id;
  if(select sum(p.amount_micro_krw) from app_private.funding_portion_clock_receipts c
   join app_private.funding_principal_portions p on p.id=c.portion_id where c.transition_id=p_transition.id and c.status='AVAILABLE') is distinct from amount_micro then
   raise exception using errcode='55000',message='FUNDING_PORTION_RELEASE_CONSERVATION_REQUIRED'; end if;
 else
  select * into request from public.withdrawal_requests where id=p_transition.original_id;
  if(select sum(p.amount_micro_krw) from app_private.funding_portion_clock_receipts c
   join app_private.funding_principal_portions p on p.id=c.portion_id where c.transition_id=p_transition.id and c.status='RECOVERED') is distinct from request.amount_atomic*1000000 then
   raise exception using errcode='55000',message='FUNDING_PORTION_FINALIZE_CONSERVATION_REQUIRED'; end if;
 end if;
 return;
end;
$$;

revoke all on function app_private.principal_boundary_prefinance_coverage_verified(uuid,uuid,uuid),
 app_private.read_principal_boundary_current_inputs(uuid,uuid,timestamptz,uuid,uuid),
 app_private.assert_principal_boundary_prefinance_portion_transition(app_private.funding_portion_transitions,uuid,uuid),
 app_private.verify_principal_boundary_prefinance_portion_fact(app_private.funding_portion_transitions,uuid,uuid)
 from public,anon,authenticated,service_role;


create function app_private.write_principal_boundary_seal(p_id uuid,p_kind text,p_user uuid,p_digest text,
 p_audit uuid,p_event uuid,p_snapshot jsonb,p_admission uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 perform app_private.assert_principal_input_executor(p_user);
 if admission.user_id is distinct from p_user then raise exception using errcode='42501',message='FUNDING_PRINCIPAL_SEAL_OWNER_MISMATCH'; end if;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(p_audit,p_user,p_kind,'FUNDING_ENGINE_V1',p_id::text,'closed admitted principal boundary',admission.journal_request_id,
  p_snapshot,jsonb_build_object('input_digest',p_digest,'principal_contract_version',1,'clock_admission_id',admission.id),admission.effective_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,available_at,last_error_code,occurred_at,created_at)
 values(p_event,p_kind||'.v1',1,'funding_engine_v1',p_id,p_user,
  jsonb_build_object('user_id',p_user,'audit_id',p_audit,'input_digest',p_digest),admission.journal_request_id,
  admission.journal_request_id,'funding:'||p_id::text||':seal','infinity','FUNDING_AUTOMATIC_RUNTIME_NOT_ENABLED',
  admission.effective_at,admission.effective_at);
end;
$$;

revoke all on function app_private.assert_principal_admission_before_finance(uuid),
 app_private.write_principal_boundary_seal(uuid,text,uuid,text,uuid,uuid,jsonb,uuid)
 from public,anon,authenticated,service_role;


-- Exact immutable replay authority has no fresh-snapshot/isolation gate.
-- Fresh producers still call132 assert_principal_input_executor separately.
create function app_private.assert_principal_history_executor(p_user uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role'
  or auth.role() is distinct from 'service_role' or p_user is null
  or(auth.uid() is not null and auth.uid() is distinct from p_user) then
  raise exception using errcode='42501',message='FUNDING_PRINCIPAL_HISTORY_EXECUTOR_FORBIDDEN';end if;
end;
$$;
revoke all on function app_private.assert_principal_history_executor(uuid) from public,anon,authenticated,service_role;

commit;
