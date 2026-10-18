begin;

-- Bounded authority foundation only. This is a trusted SERVER command type,
-- never evidence that a member confirmed principal recovery. No public alias,
-- financial writer, old-interval settlement, ACTIVE condition, capacity change,
-- retention qualification, rollover or scheduler is connected by this file.
-- A typed original survives only with the genuine130 principal HOLD originals
-- in the same transaction. Capture-only intent cannot become durable evidence.
create table app_private.funding_principal_recovery_intent_originals (
 id uuid primary key default gen_random_uuid(),
 schema_version integer not null default 1 check(schema_version=1),
 intent_kind text not null check(intent_kind='SERVER_PRINCIPAL_RECOVERY'),
 user_id uuid not null references auth.users(id),
 withdrawal_id uuid not null unique references public.withdrawal_requests(id),
 journal_request_id uuid not null,
 amount_atomic bigint not null check(amount_atomic>0),
 previous_state_id uuid not null,
 previous_condition_id uuid not null,
 current_allocation_original_id uuid,
 previous_portion_transition_id uuid not null,
 source_inputs jsonb not null check(jsonb_typeof(source_inputs)='object'),
 request_snapshot jsonb not null check(jsonb_typeof(request_snapshot)='object'),
 source_epoch_at timestamptz not null check(isfinite(source_epoch_at)),
 principal_epoch_at timestamptz not null check(isfinite(principal_epoch_at)),
 engine_epoch_at timestamptz not null check(isfinite(engine_epoch_at)),
 prepared_at timestamptz not null check(isfinite(prepared_at)),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 unique(id,user_id),
 foreign key(previous_state_id,user_id) references app_private.funding_engine_state_receipts(id,user_id),
 foreign key(previous_condition_id,user_id) references app_private.funding_condition_originals(id,user_id),
 foreign key(current_allocation_original_id,user_id) references app_private.funding_allocation_originals(id,user_id),
 foreign key(previous_portion_transition_id,user_id) references app_private.funding_portion_transitions(id,user_id)
);
alter table app_private.funding_principal_recovery_intent_originals enable row level security;
alter table app_private.funding_principal_recovery_intent_originals force row level security;
revoke all on app_private.funding_principal_recovery_intent_originals from public,anon,authenticated,service_role;
grant select on app_private.funding_principal_recovery_intent_originals to service_role;
create trigger funding_principal_recovery_intents_append_only before update or delete
 on app_private.funding_principal_recovery_intent_originals for each row execute function app_private.prevent_row_mutation();

create function app_private.funding_principal_recovery_intent_snapshot(
 p app_private.funding_principal_recovery_intent_originals) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('schema_version',p.schema_version,'intent_kind',p.intent_kind,
 'user_id',p.user_id,'withdrawal_id',p.withdrawal_id,'journal_request_id',p.journal_request_id,
 'amount_atomic',p.amount_atomic::text,'previous_state_id',p.previous_state_id,
 'previous_condition_id',p.previous_condition_id,'current_allocation_original_id',p.current_allocation_original_id,
 'previous_portion_transition_id',p.previous_portion_transition_id,'source_inputs',p.source_inputs,
 'request_snapshot',p.request_snapshot,
 'source_epoch_microseconds',((extract(epoch from p.source_epoch_at)*1000000)::bigint)::text,
 'principal_epoch_microseconds',((extract(epoch from p.principal_epoch_at)*1000000)::bigint)::text,
 'engine_epoch_microseconds',((extract(epoch from p.engine_epoch_at)*1000000)::bigint)::text,
 'prepared_at_microseconds',((extract(epoch from p.prepared_at)*1000000)::bigint)::text,
 'executor_sql_role','service_role','member_confirmation','NOT_PROVEN');
$$;

create function app_private.assert_principal_recovery_intent_completion(p_intent uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_principal_recovery_intent_originals%rowtype;
 request public.withdrawal_requests%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 movement public.money_source_movements%rowtype; transition app_private.funding_portion_transitions%rowtype;
 previous_transition app_private.funding_portion_transitions%rowtype; allocation record;
 total_micro numeric:=0; last_revision bigint;
begin
 select i.* into original from app_private.funding_principal_recovery_intent_originals i where i.id=p_intent;
 select r.* into request from public.withdrawal_requests r where r.id=original.withdrawal_id;
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=original.previous_state_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=original.previous_condition_id;
 select t.* into previous_transition from app_private.funding_portion_transitions t where t.id=original.previous_portion_transition_id;
 if original.id is null or original.intent_kind is distinct from 'SERVER_PRINCIPAL_RECOVERY'
  or request.user_id is distinct from original.user_id or request.currency<>'KRW' or request.fee_atomic<>0
  or request.welcome_reward_conversion_id is not null or request.amount_atomic is distinct from original.amount_atomic
  or original.request_snapshot is distinct from app_private.funding_withdrawal_request_snapshot(request)
  or state.user_id is distinct from original.user_id or state.condition_id is distinct from condition.id
  or condition.user_id is distinct from original.user_id or condition.inputs is distinct from original.source_inputs
  or coalesce(condition.current_allocation_original_id,condition.allocation_original_id) is distinct from original.current_allocation_original_id
  or previous_transition.user_id is distinct from original.user_id
  or original.source_inputs->>'input_contract_version' is distinct from '2'
  or original.source_epoch_at is distinct from (select introduced_at from app_private.money_source_epochs where version=1)
  or original.principal_epoch_at is distinct from (select introduced_at from app_private.funding_principal_epochs where version=1)
  or original.engine_epoch_at is distinct from (select introduced_at from app_private.funding_engine_epochs where version=1)
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(original)) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 if condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition)) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
  condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 if not exists(select 1 from public.audit_logs a where a.id=original.audit_id and a.actor_user_id=original.user_id
    and a.request_id=original.journal_request_id and a.created_at=original.prepared_at)
  or not exists(select 1 from public.outbox_events e where e.id=original.source_event_id
    and e.request_id=original.journal_request_id and e.correlation_id=original.journal_request_id
    and e.occurred_at=original.prepared_at and e.created_at=original.prepared_at) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_engine_seal(original.id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED',original.user_id,
  original.input_digest,original.audit_id,original.source_event_id,app_private.funding_principal_recovery_intent_snapshot(original));
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a
  where a.withdrawal_id=original.withdrawal_id and a.phase='HOLD';
 if admission.id is null or admission.user_id is distinct from original.user_id
  or admission.journal_request_id is distinct from original.journal_request_id
  or admission.amount_atomic is distinct from original.amount_atomic or admission.effective_at<original.prepared_at then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_HOLD_COMPLETION_REQUIRED'; end if;
 perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
 if exists(select 1 from public.mining_reward_withdrawal_reservations r
   where r.hold_ledger_transaction_id=request.hold_ledger_transaction_id)
  or (select count(*) from public.money_source_movements m where m.ledger_transaction_id=request.hold_ledger_transaction_id
    and m.user_id=original.user_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD')<>1 then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_SOURCE_REQUIRED'; end if;
 select m.* into movement from public.money_source_movements m where m.ledger_transaction_id=request.hold_ledger_transaction_id
  and m.user_id=original.user_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD';
 perform app_private.assert_principal_recovery_movement(movement);
 if movement.amount_atomic is distinct from original.amount_atomic or movement.effective_at is distinct from admission.effective_at then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_SOURCE_REQUIRED'; end if;
 -- The first bounded type requires a contiguous genuine HOLD from the exact
 -- pre-finance portion predecessor. Existing verifier independently proves
 -- newest lot, shortest eligible age, stable UUID tie, split age and conservation.
 last_revision:=previous_transition.revision;
 for allocation in select a.* from public.funding_principal_recovery_allocations a
  where a.hold_ledger_transaction_id=request.hold_ledger_transaction_id order by a.ordinal loop
  select t.* into transition from app_private.funding_portion_transitions t where t.kind='HOLD' and t.original_id=allocation.id;
  if allocation.user_id is distinct from original.user_id or allocation.policy_code is distinct from 'NEWEST_FIRST'
   or allocation.effective_at is distinct from admission.effective_at or transition.id is null
   or transition.user_id is distinct from original.user_id or transition.revision is distinct from last_revision+1
   or transition.previous_transition_id is distinct from previous_transition.id then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_COMPLETION_REQUIRED'; end if;
  perform app_private.verify_funding_portion_fact(transition);
  total_micro:=total_micro+allocation.allocation_micro_krw;
  last_revision:=transition.revision;previous_transition:=transition;
 end loop;
 if total_micro is distinct from original.amount_atomic::numeric*1000000 then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_COMPLETION_REQUIRED'; end if;
 -- This authority-only version cannot authorize an engine advancement before
 -- finance. A later adapter must add its own earned/condition/capacity proof.
 if exists(select 1 from app_private.funding_engine_state_receipts s where s.user_id=original.user_id
   and s.revision>state.revision and s.cursor_at<=admission.effective_at) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_STATE_ADVANCED'; end if;
end;
$$;

-- The current REQUESTED row is intentionally not a completed monetary source.
-- Only this exact owned, untouched pre-finance original is excluded. Every
-- other receipt/journal/projection/source/withdrawal retains the public view's
-- classification proof. No public summary or accepted reader is weakened.
create function app_private.principal_intent_prefinance_coverage_verified(p_user uuid,p_withdrawal uuid)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare request public.withdrawal_requests%rowtype; summary public.money_source_summaries%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role'
   or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='PRINCIPAL_INTENT_INPUT_PRODUCER_REQUIRED'; end if;
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal and r.user_id=p_user;
 if request.id is null or request.status<>'REQUESTED' or request.currency<>'KRW' or request.fee_atomic<>0
  or request.welcome_reward_conversion_id is not null or request.hold_ledger_transaction_id is not null
  or request.release_ledger_transaction_id is not null or request.finalize_ledger_transaction_id is not null
  or not exists(select 1 from public.wallet_accounts w where w.id=request.wallet_account_id
    and w.user_id=p_user and w.currency='KRW' and w.closed_at is null)
  or exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=request.id)
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

create function app_private.read_principal_intent_current_inputs(p_user uuid,p_allocation uuid,p_at timestamptz,p_withdrawal uuid)
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
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 if not app_private.principal_intent_prefinance_coverage_verified(p_user,p_withdrawal)
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

revoke all on function app_private.principal_intent_prefinance_coverage_verified(uuid,uuid),
 app_private.read_principal_intent_current_inputs(uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;

-- Closed pre-finance historical verification only. Original native and
-- deferred completion verifiers remain strict public COMPLETE and unchanged.
create function app_private.assert_principal_prefinance_portion_transition(p_transition app_private.funding_portion_transitions,p_withdrawal uuid)
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
 if not app_private.principal_intent_prefinance_coverage_verified(p_transition.user_id,p_withdrawal) then
  raise exception using errcode='55000',message='FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED'; end if;
end;
$$;

create function app_private.verify_principal_prefinance_portion_fact(p_transition app_private.funding_portion_transitions,p_withdrawal uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 candidate record; expected jsonb:='[]'::jsonb; actual jsonb; left_micro bigint; take_micro bigint; amount_micro bigint;
begin
 perform app_private.assert_principal_prefinance_portion_transition(p_transition,p_withdrawal);
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

revoke all on function app_private.assert_principal_prefinance_portion_transition(app_private.funding_portion_transitions,uuid),
 app_private.verify_principal_prefinance_portion_fact(app_private.funding_portion_transitions,uuid)
 from public,anon,authenticated,service_role;

create function app_private.prepare_principal_recovery_intent(p_withdrawal uuid,p_journal_request uuid) returns uuid
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare original app_private.funding_principal_recovery_intent_originals%rowtype;
 request public.withdrawal_requests%rowtype; owner_id uuid; wallet_id uuid;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; inputs jsonb; snapshot jsonb; transition app_private.funding_portion_transitions%rowtype;
begin
 -- This is a new private trusted server contract, not an old SQL-only money
 -- command. Both actual SQL and JWT service authority are required.
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='PRINCIPAL_RECOVERY_INTENT_SERVICE_ROLE_REQUIRED'; end if;
 if p_withdrawal is null or p_journal_request is null then
  raise exception using errcode='22023',message='PRINCIPAL_RECOVERY_INTENT_INVALID'; end if;
 select r.user_id into owner_id from public.withdrawal_requests r where r.id=p_withdrawal;
 if owner_id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 if auth.uid() is not null and auth.uid() is distinct from owner_id then
  raise exception using errcode='42501',message='PRINCIPAL_RECOVERY_INTENT_SUBJECT_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 select i.* into original from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=p_withdrawal;
 -- Durable replay is independent of current policy, allocation, controls and
 -- isolation. Never reinterpret a different trace as the original command.
 if original.id is not null then
  if original.journal_request_id is distinct from p_journal_request then
   raise exception using errcode='22023',message='IDEMPOTENCY_KEY_REUSED'; end if;
  perform app_private.assert_principal_recovery_intent_completion(original.id);return original.id;
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='PRINCIPAL_RECOVERY_INTENT_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal and r.user_id=owner_id for update;
 if request.currency<>'KRW' or request.fee_atomic<>0 or request.welcome_reward_conversion_id is not null
  or request.status<>'REQUESTED' or request.hold_ledger_transaction_id is not null or request.release_ledger_transaction_id is not null
  or exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=request.id)
  or exists(select 1 from public.ledger_transactions t where t.idempotency_key=request.idempotency_key||':hold'
    or(t.reference_type='withdrawal_request' and t.reference_id=request.id and t.metadata->>'phase'='HOLD'))
  or exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=request.id) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PREFINANCE_REQUEST_REQUIRED'; end if;
 select w.id into wallet_id from public.wallet_accounts w where w.id=request.wallet_account_id
  and w.user_id=owner_id and w.currency='KRW' and w.closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND'; end if;
 perform 1 from app_private.ensure_withdrawal_hold_accounts(owner_id);
 select s.* into state from app_private.funding_engine_state s where s.user_id=owner_id;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 select c.* into cycle from app_private.funding_cycle_windows c where c.id=state.cycle_id;
 if not exists(select 1 from app_private.funding_engine_activations a where a.id=state.activation_id
   and a.user_id=owner_id and a.runtime_version=2) or condition.inputs->>'input_contract_version' is distinct from '2'
  or state.cycle_closed or cycle.id is null then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_CURRENT_RUNTIME_REQUIRED'; end if;
 -- These are shared reader admissions, not another economic effective time.
 -- They precede the preparation timestamp and verify exact existing originals.
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 original.prepared_at:=clock_timestamp();
 if exists(select 1 from public.safe_mode_controls c where c.component in('GLOBAL','WITHDRAWAL')
   and c.is_paused and c.starts_at<=original.prepared_at) then
  raise exception using errcode='55000',message='SAFE_MODE_ACTIVE'; end if;
 if state.cursor_at>original.prepared_at or original.prepared_at>=cycle.cycle_end then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_FIRST_CYCLE_REQUIRED'; end if;
 original.current_allocation_original_id:=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 inputs:=app_private.read_principal_intent_current_inputs(owner_id,original.current_allocation_original_id,original.prepared_at,request.id);
 if condition.inputs is distinct from inputs then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_CURRENT_INPUTS_REQUIRED'; end if;
 if request.amount_atomic>(inputs->>'principal_atomic')::bigint then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_INSUFFICIENT_PRINCIPAL'; end if;
 -- No roots or retrospective portion clock facts are fabricated here.
 if (select coalesce(sum(p.amount_micro_krw),0) from app_private.funding_principal_portions p
    join app_private.funding_portion_clock_state c on c.portion_id=p.id where p.user_id=owner_id and c.status='AVAILABLE')
   is distinct from (inputs->>'principal_atomic')::numeric*1000000 then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_ORIGINAL_REQUIRED'; end if;
 for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=owner_id order by t.revision loop
  perform app_private.verify_principal_prefinance_portion_fact(transition,request.id);
 end loop;
 select t.id into original.previous_portion_transition_id from app_private.funding_portion_transitions t
  where t.user_id=owner_id order by t.revision desc limit 1;
 if original.previous_portion_transition_id is null then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_ORIGINAL_REQUIRED'; end if;
 original.id:=gen_random_uuid();original.schema_version:=1;original.intent_kind:='SERVER_PRINCIPAL_RECOVERY';
 original.user_id:=owner_id;original.withdrawal_id:=request.id;original.journal_request_id:=p_journal_request;
 original.amount_atomic:=request.amount_atomic;original.previous_state_id:=state.id;original.previous_condition_id:=condition.id;
 original.source_inputs:=inputs;original.request_snapshot:=app_private.funding_withdrawal_request_snapshot(request);
 select introduced_at into original.source_epoch_at from app_private.money_source_epochs where version=1;
 select introduced_at into original.principal_epoch_at from app_private.funding_principal_epochs where version=1;
 select introduced_at into original.engine_epoch_at from app_private.funding_engine_epochs where version=1;
 original.audit_id:=gen_random_uuid();original.source_event_id:=gen_random_uuid();
 snapshot:=app_private.funding_principal_recovery_intent_snapshot(original);original.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into app_private.funding_principal_recovery_intent_originals select original.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(original.audit_id,owner_id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED','FUNDING_ENGINE_V1',original.id::text,
  'private trusted server principal command type; member confirmation not proven',p_journal_request,snapshot,
  jsonb_build_object('input_digest',original.input_digest,'engine_contract',2),original.prepared_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at,available_at,last_error_code)
 values(original.source_event_id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED.v1',1,'funding_engine_v1',original.id,owner_id,
  jsonb_build_object('user_id',owner_id,'audit_id',original.audit_id,'input_digest',original.input_digest),p_journal_request,p_journal_request,
  'funding:'||original.id::text||':seal',original.prepared_at,original.prepared_at,'infinity','FUNDING_PRINCIPAL_ACTIVE_ADAPTER_NOT_ENABLED');
 return original.id;
end;
$$;

create function app_private.verify_principal_recovery_intent_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if tg_table_schema<>'app_private' or tg_table_name<>'funding_principal_recovery_intent_originals'
  or tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_COMMIT_CONTEXT_INVALID'; end if;
 if ((current_setting('role',true)='service_role' and auth.role()='service_role'
    and(auth.uid() is null or auth.uid()=new.user_id))
   or(current_setting('role',true) in('none','postgres') and session_user='postgres')) is not true then
  raise exception using errcode='42501',message='PRINCIPAL_RECOVERY_INTENT_COMMIT_CONTEXT_FORBIDDEN'; end if;
 perform app_private.assert_principal_recovery_intent_completion(new.id);return null;
end;
$$;
create constraint trigger funding_principal_recovery_intent_complete after insert
 on app_private.funding_principal_recovery_intent_originals deferrable initially deferred
 for each row execute function app_private.verify_principal_recovery_intent_commit();

create function app_private.guard_principal_recovery_intent_links() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if tg_table_schema<>'public' or tg_table_name not in('audit_logs','outbox_events','withdrawal_requests') then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_LINK_CONTEXT_INVALID'; end if;
 if tg_table_name='audit_logs' then
  if exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.audit_id=old.id)
    and(tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_IMMUTABLE'; end if;
 elsif tg_table_name='outbox_events' then
  if exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.source_event_id=old.id)
   and(tg_op='DELETE' or row(new.event_type,new.schema_version,new.aggregate_type,new.aggregate_id,new.actor_user_id,
     new.payload,new.request_id,new.correlation_id,new.idempotency_key,new.occurred_at,new.created_at)
    is distinct from row(old.event_type,old.schema_version,old.aggregate_type,old.aggregate_id,old.actor_user_id,
     old.payload,old.request_id,old.correlation_id,old.idempotency_key,old.occurred_at,old.created_at)) then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_IMMUTABLE'; end if;
 else
  if exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=old.id)
   and(tg_op='DELETE' or app_private.funding_withdrawal_request_snapshot(new)
     is distinct from app_private.funding_withdrawal_request_snapshot(old)) then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_REQUEST_IMMUTABLE'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;return new;
end;
$$;
create trigger principal_recovery_intent_audit_immutable before update or delete on public.audit_logs
 for each row execute function app_private.guard_principal_recovery_intent_links();
create trigger principal_recovery_intent_event_immutable before update or delete on public.outbox_events
 for each row execute function app_private.guard_principal_recovery_intent_links();
create trigger principal_recovery_intent_request_immutable before update or delete on public.withdrawal_requests
 for each row execute function app_private.guard_principal_recovery_intent_links();

alter function app_private.prepare_principal_recovery_intent(uuid,uuid) owner to postgres;
alter function app_private.verify_principal_recovery_intent_commit() owner to postgres;
revoke all on function app_private.funding_principal_recovery_intent_snapshot(app_private.funding_principal_recovery_intent_originals),
 app_private.assert_principal_recovery_intent_completion(uuid),app_private.prepare_principal_recovery_intent(uuid,uuid),
 app_private.verify_principal_recovery_intent_commit(),app_private.guard_principal_recovery_intent_links()
 from public,anon,authenticated,service_role;
grant execute on function app_private.funding_principal_recovery_intent_snapshot(app_private.funding_principal_recovery_intent_originals),
 app_private.assert_principal_recovery_intent_completion(uuid),app_private.prepare_principal_recovery_intent(uuid,uuid),
 app_private.guard_principal_recovery_intent_links() to service_role;

commit;
