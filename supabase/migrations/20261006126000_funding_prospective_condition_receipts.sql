begin;

-- Prospective neutral/default conditions. No automatic scheduler, deposit hook,
-- source/hold restoration, or retrospective repair is enabled by this slice.
-- V1 owner-only foundation originals and their validations remain unchanged.
alter table app_private.funding_engine_activations
 add column runtime_version integer not null default 1 check(runtime_version in(1,2)),
 add column input_original jsonb,
 alter column allocation_original_id drop not null,
 add constraint funding_activation_runtime_branch check(
  (runtime_version=1 and allocation_original_id is not null and input_original is null)
  or (runtime_version=2 and allocation_original_id is null and input_original is not null and jsonb_typeof(input_original)='object'));

create table app_private.funding_condition_originals(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 activation_id uuid not null references app_private.funding_engine_activations(id),
 revision bigint not null check(revision>=0),
 previous_condition_id uuid references app_private.funding_condition_originals(id),
 allocation_original_id uuid unique references app_private.funding_allocation_originals(id),
 effective_at timestamptz not null check(isfinite(effective_at)),
 inputs jsonb not null check(jsonb_typeof(inputs)='object'),
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 source_event_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(user_id,revision),unique(id,user_id),
 check((revision=0 and previous_condition_id is null and allocation_original_id is null)
  or(revision>0 and previous_condition_id is not null and allocation_original_id is not null))
);
alter table app_private.funding_condition_originals enable row level security;
alter table app_private.funding_condition_originals force row level security;
revoke all on app_private.funding_condition_originals from public,anon,authenticated,service_role;
grant select on app_private.funding_condition_originals to service_role;
create trigger funding_condition_append_only before update or delete on app_private.funding_condition_originals
 for each row execute function app_private.prevent_row_mutation();
alter table app_private.funding_engine_state_receipts add column condition_id uuid,
 add constraint funding_state_condition_owner_fk foreign key(condition_id,user_id)
 references app_private.funding_condition_originals(id,user_id) deferrable initially deferred;
-- Exact existing PG17 constraint, verified by root's scoped local inventory.
do $earned_interval_constraint$
begin
 if not exists(select 1 from pg_constraint where conrelid='app_private.funding_earned_receipts'::regclass
  and conname='funding_earned_receipts_check' and contype='c'
  and pg_get_constraintdef(oid)='CHECK ((settled_to > settled_from))') then
  raise exception using errcode='55000',message='FUNDING_EARNED_INTERVAL_CONSTRAINT_MISMATCH'; end if;
end;
$earned_interval_constraint$;
alter table app_private.funding_earned_receipts
 add column runtime_version integer not null default 1 check(runtime_version in(1,2)),
 add column condition_id uuid,
 add column cause_allocation_id uuid unique references app_private.funding_allocation_originals(id),
 alter column job_id drop not null, alter column attempt_number drop not null,
 alter column worker_id drop not null,alter column fence_expires_at drop not null,
 drop constraint funding_earned_receipts_check,
 add constraint funding_earned_interval_order check(settled_to>settled_from
  or(runtime_version=2 and cause_allocation_id is not null and settled_to=settled_from)),
 add constraint funding_earned_condition_owner_fk foreign key(condition_id,user_id)
 references app_private.funding_condition_originals(id,user_id),
 add constraint funding_earned_cause_branch check(
  (runtime_version=1 and condition_id is null and cause_allocation_id is null
    and job_id is not null and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
  or(runtime_version=2 and condition_id is not null and
    ((job_id is not null and cause_allocation_id is null and attempt_number is not null and worker_id is not null and fence_expires_at is not null)
     or(job_id is null and cause_allocation_id is not null and attempt_number is null and worker_id is null and fence_expires_at is null))));

-- Direct private foreground invocation is never a member/public/service grant.
-- The authenticated canonical writer is a hardened postgres-owned definer; its
-- original, auth subject and completed command receipt are independently checked.
create function app_private.assert_funding_member_writer(p_user uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'postgres' or auth.role() is distinct from 'authenticated' or auth.uid() is distinct from p_user then
  raise exception using errcode='42501',message='FUNDING_MEMBER_WRITER_REQUIRED'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
end;
$$;

create function app_private.assert_prospective_allocation(p_id uuid,p_user uuid,p_config jsonb,p_slots integer)
returns integer language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare a app_private.funding_allocation_originals%rowtype; log public.audit_logs%rowtype;
 item jsonb; total integer:=0; bps integer; publication uuid;
begin
 select * into a from app_private.funding_allocation_originals where id=p_id;
 select * into log from public.audit_logs where id=a.audit_id;
 if a.id is null or a.user_id is distinct from p_user or a.effects<>'{}'
  or a.recorded_at is distinct from a.effective_at or a.effective_at>clock_timestamp()
  or jsonb_array_length(a.products)>p_slots
  or a.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_allocation_snapshot(a)) then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_ALLOCATION_INVALID'; end if;
 perform app_private.assert_funding_engine_seal(a.id,'FUNDING_ALLOCATION_CONFIRMED',p_user,a.input_digest,
  a.audit_id,a.source_event_id,app_private.funding_allocation_snapshot(a));
 publication:=app_private.assert_published_product_catalog(a.catalog_version_id);
 if log.actor_user_id is distinct from p_user or log.created_at is distinct from a.effective_at
  or log.metadata->>'command_version' is distinct from '1'
  or log.metadata->>'expected_revision' is distinct from (a.revision-1)::text
  or log.metadata->>'catalog_publication_receipt_id' is distinct from publication::text
  or char_length(coalesce(log.metadata->>'idempotency_key','')) not between 8 and 200
  or not exists(select 1 from public.outbox_events e where e.id=a.source_event_id
    and e.occurred_at=a.effective_at and e.created_at=a.effective_at and e.correlation_id=log.request_id)
  or (select count(*) from app_private.funding_allocation_originals where user_id=p_user and revision<=a.revision)<>a.revision
  or (select published_at from public.product_catalog_versions where id=a.catalog_version_id)>a.effective_at then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_COMMAND_ORIGINAL_REQUIRED'; end if;
 if (select count(distinct value->>'productId') from jsonb_array_elements(a.products))<>jsonb_array_length(a.products) then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_DUPLICATE_PRODUCT'; end if;
 for item in select value from jsonb_array_elements(a.products) loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>3
   or not item ?& array['productId','ruleVersionId','allocationBps']
   or jsonb_typeof(item->'allocationBps') is distinct from 'string'
   or coalesce(item->>'allocationBps','') !~ '^[1-9][0-9]{0,4}$' then
   raise exception using errcode='55000',message='FUNDING_ALLOCATION_PAYLOAD_UNSUPPORTED'; end if;
  bps:=(item->>'allocationBps')::integer;
  if bps>(p_config#>>'{allocation,maximumPerProductBps}')::integer
   or not exists(select 1 from public.product_rule_versions r join public.mining_products p on p.id=r.product_id
    join public.product_availability av on av.product_id=p.id
    where r.id=(item->>'ruleVersionId')::uuid and p.id=(item->>'productId')::uuid
     and p.catalog_version_id=a.catalog_version_id and r.rule_payload='{}' and r.approved_by is not null
     and r.effective_at<=a.effective_at and r.retired_at is null
     and av.status='AVAILABLE' and av.available_from<=a.effective_at
     and (av.available_to is null or av.available_to>a.effective_at) and av.segment_key is null) then
   raise exception using errcode='55000',message='FUNDING_NEUTRAL_PRODUCT_RULE_REQUIRED'; end if;
  total:=total+bps;
 end loop;
 if total>(p_config#>>'{allocation,maximumTotalBps}')::integer then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_LIMIT_EXCEEDED'; end if;
 return total;
end;
$$;

create function app_private.read_prospective_funding_inputs(p_credit uuid,p_allocation uuid,p_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare movement public.money_source_movements%rowtype; principal public.funding_principal_revisions%rowtype;
 policy app_private.economy_policy_published%rowtype; receipt app_private.economy_policy_receipts%rowtype;
 policy_revision integer:=0; previous uuid; tier jsonb; allocation_bps integer:=0;
begin
 select * into movement from public.money_source_movements where id=p_credit;
 if movement.id is null or movement.source_bucket<>'PRINCIPAL' or movement.movement_kind<>'CREDIT'
  or movement.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT') or not isfinite(p_at)
  or p_at<movement.effective_at or p_at>clock_timestamp()
  or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1) then
  raise exception using errcode='55000',message='FUNDING_FRESH_PRINCIPAL_REQUIRED'; end if;
 perform app_private.assert_money_source_credit(movement);
 if (select coverage from public.money_source_summaries where user_id=movement.user_id) is distinct from 'COMPLETE'
  or (select count(*) from public.funding_principal_lots where user_id=movement.user_id)<>1
  or (select count(*) from public.funding_principal_revisions where user_id=movement.user_id)<>1
  or (select count(*) from public.money_source_movements where user_id=movement.user_id and source_bucket='PRINCIPAL')<>1
  or exists(select 1 from public.funding_principal_recovery_allocations where user_id=movement.user_id)
  or exists(select 1 from public.funding_principal_recovery_releases where user_id=movement.user_id)
  or exists(select 1 from app_private.funding_cycle_segments where user_id=movement.user_id) then
  raise exception using errcode='55000',message='FUNDING_SOURCE_BOUNDARY_ADAPTER_REQUIRED'; end if;
 select * into principal from public.funding_principal_revisions where money_source_movement_id=p_credit;
 if principal.user_id is distinct from movement.user_id or principal.direction is distinct from 'INCREASE'
  or principal.effective_at is distinct from movement.effective_at
  or principal.ledger_transaction_id is distinct from movement.ledger_transaction_id
  or principal.source_event_id is distinct from movement.source_event_id
  or principal.delta_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
  or principal.eligible_principal_micro_krw_after is distinct from principal.delta_micro_krw
  or app_private.funding_principal_mining_eligible_micro(movement.user_id,clock_timestamp()) is distinct from principal.delta_micro_krw then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ORIGINAL_MISMATCH'; end if;
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
  or policy.config#>>'{allocation,capacityScope}' is distinct from 'GLOBAL_CYCLE'
  or (policy.config->>'minimumPrincipalKrw')::bigint>movement.amount_atomic then
  raise exception using errcode='55000',message='FUNDING_DEFAULT_POLICY_REQUIRED'; end if;
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::bigint<=movement.amount_atomic
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::bigint>=movement.amount_atomic);
 if tier is null then raise exception using errcode='55000',message='FUNDING_TIER_UNRESOLVED'; end if;
 if p_allocation is not null then
  allocation_bps:=app_private.assert_prospective_allocation(p_allocation,movement.user_id,policy.config,(tier->>'slots')::integer);
  if (select effective_at from app_private.funding_allocation_originals where id=p_allocation)>p_at then
   raise exception using errcode='55000',message='FUNDING_ALLOCATION_FUTURE_INPUT'; end if;
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 if exists(select 1 from public.safe_mode_controls where component in('GLOBAL','NEW_MINING','SETTLEMENT')
   and(is_paused or starts_at>=movement.effective_at))
  or exists(select 1 from public.audit_logs where target_type='SAFE_MODE' and target_id in('GLOBAL','NEW_MINING','SETTLEMENT')
   and(after_state->>'starts_at')::timestamptz>=movement.effective_at)
  or exists(select 1 from public.block_rules where user_id=movement.user_id and scope='ACCOUNT'
   and(ends_at is null or ends_at>movement.effective_at)) then
  raise exception using errcode='55000',message='FUNDING_CONTROL_BOUNDARY_ADAPTER_REQUIRED'; end if;
 return jsonb_build_object('user_id',movement.user_id,'credit_id',movement.id,'principal_revision_id',principal.id,
  'principal_atomic',movement.amount_atomic::text,'credit_at_microseconds',((extract(epoch from movement.effective_at)*1000000)::bigint)::text,
  'allocation_id',p_allocation,'allocation_digest',(select input_digest from app_private.funding_allocation_originals where id=p_allocation),
  'allocation_bps',allocation_bps,'policy_publication_id',policy.publication_id,'policy_config_digest',policy.config_digest,
  'policy_effective_from_microseconds',((extract(epoch from policy.effective_from)*1000000)::bigint)::text,
  'cycle_days',(policy.config->>'cycleDays')::integer,'base_bps',(policy.config->>'baseCycleRateBps')::integer,
  'retention_bps',(tier->>'retentionBonusBps')::integer);
end;
$$;

create function app_private.funding_condition_snapshot(p_condition app_private.funding_condition_originals)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_condition.user_id,'activation_id',p_condition.activation_id,
  'revision',p_condition.revision::text,'previous_condition_id',p_condition.previous_condition_id,
  'allocation_id',p_condition.allocation_original_id,
  'effective_at_microseconds',((extract(epoch from p_condition.effective_at)*1000000)::bigint)::text,
  'inputs',p_condition.inputs);
$$;

create function app_private.guard_funding_condition() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; previous app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; inputs jsonb;
begin
 perform app_private.assert_funding_member_writer(new.user_id);
 select * into activation from app_private.funding_engine_activations where id=new.activation_id;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,new.allocation_original_id,new.effective_at);
 if activation.user_id is distinct from new.user_id or activation.runtime_version<>2
  or new.inputs is distinct from inputs
  or new.inputs->>'policy_publication_id' is distinct from activation.policy_publication_id::text
  or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(new)) then
  raise exception using errcode='55000',message='FUNDING_CONDITION_ORIGINAL_MISMATCH'; end if;
 if new.revision=0 then
  if new.effective_at is distinct from activation.effective_at or new.inputs is distinct from activation.input_original then
   raise exception using errcode='55000',message='FUNDING_ZERO_CONDITION_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_condition_originals where id=new.previous_condition_id;
  select * into original from app_private.funding_allocation_originals where id=new.allocation_original_id;
  if previous.user_id is distinct from new.user_id or previous.activation_id is distinct from new.activation_id
   or new.revision is distinct from previous.revision+1 or new.revision is distinct from original.revision
   or new.effective_at is distinct from original.effective_at or new.effective_at<previous.effective_at
   or new.previous_condition_id is distinct from(select id from app_private.funding_condition_originals
     where user_id=new.user_id order by revision desc limit 1) then
   raise exception using errcode='55000',message='FUNDING_CONDITION_SUCCESSOR_MISMATCH'; end if;
 end if;
 return new;
end;
$$;
create trigger funding_condition_validate before insert on app_private.funding_condition_originals
 for each row execute function app_private.guard_funding_condition();

-- No intermediate rounding. Zero allocation only removes BASE, not principal
-- conditional maintenance. The V1 bounded function continues rejecting zero.
create function app_private.funding_exact_condition_interval(
  p_principal_atomic bigint, p_base_bps integer, p_retention_bps integer,
  p_allocation_bps integer, p_cycle_microseconds bigint, p_elapsed_microseconds bigint,
  p_base_used_num numeric, p_base_used_den numeric,
  p_retention_used_num numeric, p_retention_used_den numeric,
  p_carry_num numeric, p_carry_den numeric, p_qualify_retention boolean
) returns jsonb language plpgsql immutable security invoker set search_path = pg_catalog
as $$
declare
  v_base numeric[]; v_retention numeric[]; v_remaining numeric[];
  v_base_used numeric[]; v_retention_used numeric[]; v_carry numeric[];
  v_total numeric[]; v_qualified numeric[] := array[0::numeric,1::numeric];
  v_whole numeric;
begin
  if p_principal_atomic is null or p_principal_atomic <= 0
    or p_base_bps is null or p_base_bps < 0 or p_base_bps > 10000
    or p_retention_bps is null or p_retention_bps < 0 or p_retention_bps > 10000
    or p_allocation_bps is null or p_allocation_bps not between 0 and 10000
    or p_cycle_microseconds is null or p_cycle_microseconds <= 0
    or p_elapsed_microseconds is null or p_elapsed_microseconds < 0
    or p_elapsed_microseconds > p_cycle_microseconds or p_qualify_retention is null then
    raise exception using errcode='22023',message='FUNDING_DEFAULT_INTERVAL_INVALID';
  end if;
  v_base_used := app_private.funding_exact_ratio(p_base_used_num,p_base_used_den);
  v_retention_used := app_private.funding_exact_ratio(p_retention_used_num,p_retention_used_den);
  v_carry := app_private.funding_exact_ratio(p_carry_num,p_carry_den);
  if v_carry[1] >= v_carry[2] then
    raise exception using errcode='22023',message='FUNDING_CARRY_INVALID';
  end if;
  v_base := app_private.funding_exact_ratio(p_principal_atomic::numeric*p_base_bps
    *p_elapsed_microseconds*p_allocation_bps,10000::numeric*p_cycle_microseconds*10000);
  v_remaining := app_private.funding_exact_ratio(greatest(0,
    p_principal_atomic::numeric*p_base_bps*v_base_used[2]-v_base_used[1]*10000),10000*v_base_used[2]);
  if v_base[1]*v_remaining[2] > v_remaining[1]*v_base[2] then v_base := v_remaining; end if;
  -- Maintenance is principal-based and independent of BASE product allocation
  -- weights/modifiers. Its eligibility/qualification remains a separate proof.
  v_retention := app_private.funding_exact_ratio(p_principal_atomic::numeric*p_retention_bps
    *p_elapsed_microseconds,10000::numeric*p_cycle_microseconds);
  v_remaining := app_private.funding_exact_ratio(greatest(0,
    p_principal_atomic::numeric*p_retention_bps*v_retention_used[2]-v_retention_used[1]*10000),
    10000*v_retention_used[2]);
  if v_retention[1]*v_remaining[2] > v_remaining[1]*v_retention[2] then v_retention := v_remaining; end if;
  v_base_used := app_private.funding_exact_sum(v_base_used,v_base);
  v_retention_used := app_private.funding_exact_sum(v_retention_used,v_retention);
  if p_qualify_retention then v_qualified := v_retention_used; end if;
  v_total := app_private.funding_exact_sum(app_private.funding_exact_sum(v_carry,v_base),v_qualified);
  v_whole := div(v_total[1],v_total[2]);
  if v_whole > 9223372036854775807 then
    raise exception using errcode='22003',message='FUNDING_WHOLE_KRW_OVERFLOW';
  end if;
  v_carry := app_private.funding_exact_ratio(mod(v_total[1],v_total[2]),v_total[2]);
  -- Unlike generic ANY jsonb_build_object (STABLE), jsonb_object(text[],text[])
  -- and numeric output are IMMUTABLE. These fixed keys + validated exact
  -- integer strings preserve both JSON semantics and the pure math contract.
  return jsonb_object(array['baseNum','baseDen','conditionalRetentionNum','conditionalRetentionDen',
    'baseUsedNum','baseUsedDen','retentionUsedNum','retentionUsedDen',
    'qualifiedRetentionNum','qualifiedRetentionDen','amountAtomic','carryNum','carryDen'],
    array[v_base[1]::text,v_base[2]::text,v_retention[1]::text,v_retention[2]::text,
      v_base_used[1]::text,v_base_used[2]::text,v_retention_used[1]::text,v_retention_used[2]::text,
      v_qualified[1]::text,v_qualified[2]::text,v_whole::text,v_carry[1]::text,v_carry[2]::text]);
end;
$$;

create or replace view app_private.funding_engine_state with(security_invoker=true) as
 select distinct on(user_id) * from app_private.funding_engine_state_receipts order by user_id,revision desc;

create function app_private.validate_prospective_activation(p_activation app_private.funding_engine_activations)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare inputs jsonb; cycle app_private.funding_cycle_windows%rowtype;
begin
 perform app_private.assert_funding_member_writer(p_activation.user_id);
 inputs:=app_private.read_prospective_funding_inputs(p_activation.trigger_credit_movement_id,null,p_activation.effective_at);
 select * into cycle from app_private.funding_cycle_windows where id=p_activation.first_cycle_id;
 if p_activation.input_original is distinct from inputs
  or p_activation.user_id::text is distinct from inputs->>'user_id'
  or p_activation.trigger_principal_revision_id::text is distinct from inputs->>'principal_revision_id'
  or p_activation.policy_publication_id::text is distinct from inputs->>'policy_publication_id'
  or p_activation.principal_atomic::text is distinct from inputs->>'principal_atomic'
  or ((extract(epoch from p_activation.effective_at)*1000000)::bigint)::text is distinct from inputs->>'credit_at_microseconds'
  or p_activation.input_digest is distinct from app_private.funding_engine_digest(inputs)
  or cycle.user_id is distinct from p_activation.user_id or cycle.cycle_ordinal is distinct from 0
  or cycle.cycle_started_at is distinct from p_activation.effective_at
  or cycle.cycle_days is distinct from(inputs->>'cycle_days')::integer then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_ACTIVATION_MISMATCH'; end if;
end;
$$;

create function app_private.validate_prospective_state(p_state app_private.funding_engine_state_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; condition app_private.funding_condition_originals%rowtype;
 previous app_private.funding_engine_state_receipts%rowtype; earned app_private.funding_earned_receipts%rowtype;
 cycle app_private.funding_cycle_windows%rowtype;
begin
 select * into activation from app_private.funding_engine_activations where id=p_state.activation_id;
 select * into condition from app_private.funding_condition_originals where id=p_state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=p_state.cycle_id;
 if p_state.user_id is distinct from activation.user_id or condition.user_id is distinct from p_state.user_id
  or condition.activation_id is distinct from activation.id or p_state.cycle_id is distinct from activation.first_cycle_id
  or p_state.cursor_at<cycle.cycle_started_at or p_state.cursor_at>=cycle.cycle_end or p_state.cycle_closed
  or condition.effective_at>p_state.cursor_at
  or app_private.funding_exact_ratio(p_state.base_used_num,p_state.base_used_den) is distinct from array[p_state.base_used_num,p_state.base_used_den]
  or app_private.funding_exact_ratio(p_state.retention_used_num,p_state.retention_used_den) is distinct from array[p_state.retention_used_num,p_state.retention_used_den]
  or app_private.funding_exact_ratio(p_state.carry_num,p_state.carry_den) is distinct from array[p_state.carry_num,p_state.carry_den] then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_STATE_MISMATCH'; end if;
 if p_state.revision=0 then
  if condition.revision<>0 or p_state.cursor_at<>activation.effective_at
   or p_state.base_used_num<>0 or p_state.base_used_den<>1 or p_state.retention_used_num<>0 or p_state.retention_used_den<>1
   or p_state.carry_num<>0 or p_state.carry_den<>1 then
   raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
 else
  select * into previous from app_private.funding_engine_state_receipts where id=p_state.previous_state_id;
  select * into earned from app_private.funding_earned_receipts where id=p_state.earned_receipt_id;
  if previous.user_id is distinct from p_state.user_id or previous.activation_id is distinct from p_state.activation_id
   or previous.id is distinct from(select id from app_private.funding_engine_state where user_id=p_state.user_id)
   or p_state.revision is distinct from previous.revision+1 or previous.cycle_closed or earned.runtime_version<>2
   or earned.next_state_id is distinct from p_state.id or earned.previous_state_id is distinct from previous.id
   or p_state.cursor_at is distinct from earned.settled_to
   or (earned.cause_allocation_id is not null and condition.allocation_original_id is distinct from earned.cause_allocation_id)
   or (earned.job_id is not null and p_state.condition_id is distinct from previous.condition_id)
   or p_state.base_used_num::text is distinct from earned.calculation->>'baseUsedNum'
   or p_state.base_used_den::text is distinct from earned.calculation->>'baseUsedDen'
   or p_state.retention_used_num::text is distinct from earned.calculation->>'retentionUsedNum'
   or p_state.retention_used_den::text is distinct from earned.calculation->>'retentionUsedDen'
   or p_state.carry_num::text is distinct from earned.calculation->>'carryNum'
   or p_state.carry_den::text is distinct from earned.calculation->>'carryDen' then
   raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
 end if;
end;
$$;

create function app_private.validate_prospective_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; successor app_private.funding_condition_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 inputs jsonb; calculation jsonb;
begin
 -- Jobs cannot use the foreground branch or gain a fake successful lease.
 if p_earned.job_id is not null then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_JOB_ADAPTER_REQUIRED'; end if;
 perform app_private.assert_funding_member_writer(p_earned.user_id);
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_earned.user_id::text,0));
 select * into activation from app_private.funding_engine_activations where id=p_earned.activation_id;
 select * into state from app_private.funding_engine_state_receipts where id=p_earned.previous_state_id;
 select * into condition from app_private.funding_condition_originals where id=p_earned.condition_id;
 select * into original from app_private.funding_allocation_originals where id=p_earned.cause_allocation_id;
 select * into successor from app_private.funding_condition_originals where allocation_original_id=original.id;
 select * into cycle from app_private.funding_cycle_windows where id=p_earned.cycle_id;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,p_earned.settled_to);
 if activation.runtime_version<>2 or activation.user_id is distinct from p_earned.user_id
  or state.user_id is distinct from p_earned.user_id or state.activation_id is distinct from activation.id
  or state.id is distinct from(select id from app_private.funding_engine_state where user_id=p_earned.user_id)
  or p_earned.condition_id is distinct from state.condition_id or inputs is distinct from condition.inputs
  or original.user_id is distinct from p_earned.user_id or successor.previous_condition_id is distinct from condition.id
  or successor.effective_at is distinct from original.effective_at
  or p_earned.settled_from is distinct from state.cursor_at or p_earned.settled_to is distinct from original.effective_at
  or p_earned.settled_to>clock_timestamp() or p_earned.settled_to>=cycle.cycle_end
  or p_earned.cycle_id is distinct from activation.first_cycle_id then
  raise exception using errcode='55000',message='FUNDING_PROSPECTIVE_EARNED_MISMATCH'; end if;
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from p_earned.settled_to-p_earned.settled_from)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 if p_earned.calculation is distinct from calculation or p_earned.amount_atomic::text is distinct from calculation->>'amountAtomic'
  or p_earned.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(p_earned)) then
  raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
end;
$$;

create function app_private.verify_prospective_activation(p_activation app_private.funding_engine_activations)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if not exists(select 1 from app_private.funding_engine_state_receipts s
  join app_private.funding_condition_originals c on c.id=s.condition_id
  where s.activation_id=p_activation.id and s.revision=0 and c.revision=0 and c.inputs=p_activation.input_original) then
  raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
 perform app_private.assert_funding_engine_seal(p_activation.id,'FUNDING_ACTIVATED',p_activation.user_id,p_activation.input_digest,
  p_activation.audit_id,p_activation.source_event_id,app_private.funding_activation_snapshot(p_activation));
end;
$$;

create function app_private.assert_allocation_boundary_complete(p_allocation uuid,p_transition uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_allocation_originals%rowtype; log public.audit_logs%rowtype;
begin
 select * into original from app_private.funding_allocation_originals where id=p_allocation;
 select * into log from public.audit_logs where id=original.audit_id;
 if not exists(select 1 from app_private.idempotency_keys i where i.scope='funding.allocation'
   and i.actor_id=original.user_id and i.idempotency_key=log.metadata->>'idempotency_key' and i.status='COMPLETED'
   and i.response_status=200 and i.completed_at>=original.effective_at
   and i.response_payload->>'allocationId'=original.id::text
   and i.response_payload->>'transitionId'=p_transition::text
   and i.response_payload->>'revision'=original.revision::text
   and i.response_payload->>'inputDigest'=original.input_digest) then
  raise exception using errcode='55000',message='FUNDING_ALLOCATION_COMMAND_COMPLETION_MISSING'; end if;
 perform app_private.assert_funding_engine_seal(original.id,'FUNDING_ALLOCATION_CONFIRMED',original.user_id,
  original.input_digest,original.audit_id,original.source_event_id,app_private.funding_allocation_snapshot(original));
end;
$$;

create function app_private.verify_prospective_earned(p_earned app_private.funding_earned_receipts)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare successor app_private.funding_engine_state_receipts%rowtype; transition app_private.funding_condition_originals%rowtype;
 movement public.money_source_movements%rowtype;
begin
 select * into successor from app_private.funding_engine_state_receipts where id=p_earned.next_state_id;
 select * into transition from app_private.funding_condition_originals where id=successor.condition_id;
 if successor.earned_receipt_id is distinct from p_earned.id or successor.user_id is distinct from p_earned.user_id
  or transition.allocation_original_id is distinct from p_earned.cause_allocation_id or p_earned.job_id is not null then
  raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
 perform app_private.assert_allocation_boundary_complete(p_earned.cause_allocation_id,transition.id);
 if p_earned.amount_atomic>0 then
  select m.* into movement from public.money_source_movements m join public.mining_reward_credits c
   on c.ledger_transaction_id=m.ledger_transaction_id where c.id=p_earned.credit_id and c.funding_earned_receipt_id=p_earned.id;
  if movement.user_id is distinct from p_earned.user_id or movement.amount_atomic is distinct from p_earned.amount_atomic
   or movement.source_bucket is distinct from 'MINING_REWARD' or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at is distinct from p_earned.settled_to
   or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=p_earned.id)
   or not exists(select 1 from public.mining_settlements where id=p_earned.settlement_id and funding_earned_receipt_id=p_earned.id) then
   raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
  perform app_private.assert_money_source_credit(movement);
 end if;
 if p_earned.calculation->>'qualifiedRetentionNum' is distinct from '0' then
  raise exception using errcode='55000',message='FUNDING_RETENTION_BOUNDARY_ADAPTER_REQUIRED'; end if;
 perform app_private.assert_funding_engine_seal(p_earned.id,'FUNDING_EARNED_ACCEPTED',p_earned.user_id,p_earned.input_digest,
  p_earned.audit_id,p_earned.source_event_id,app_private.funding_earned_snapshot(p_earned));
end;
$$;

create function app_private.verify_funding_condition_complete() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 perform app_private.assert_funding_engine_seal(new.id,'FUNDING_CONDITION_CHANGED',new.user_id,new.input_digest,
  new.audit_id,new.source_event_id,app_private.funding_condition_snapshot(new));
 if new.revision=0 then
  if not exists(select 1 from app_private.funding_engine_state_receipts where condition_id=new.id and revision=0) then
   raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
 else
  perform app_private.assert_allocation_boundary_complete(new.allocation_original_id,new.id);
  if not exists(select 1 from app_private.funding_engine_state_receipts s join app_private.funding_earned_receipts e
   on e.id=s.earned_receipt_id where s.condition_id=new.id and e.cause_allocation_id=new.allocation_original_id
    and e.condition_id=new.previous_condition_id) then
   raise exception using errcode='55000',message='FUNDING_ALLOCATION_ACCEPTANCE_MISSING'; end if;
 end if;
 return null;
end;
$$;
create constraint trigger funding_condition_complete after insert on app_private.funding_condition_originals
 deferrable initially deferred for each row execute function app_private.verify_funding_condition_complete();

-- Explicit V2 dispatch leaves V1 guards and immutable seals compatible.
create or replace function app_private.funding_activation_snapshot(p_a app_private.funding_engine_activations)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_a.user_id,'credit_id',p_a.trigger_credit_movement_id,
   'principal_revision_id',p_a.trigger_principal_revision_id,'allocation_id',p_a.allocation_original_id,
   'policy_publication_id',p_a.policy_publication_id,'cycle_id',p_a.first_cycle_id,
   'principal_atomic',p_a.principal_atomic::text,'effective_at_microseconds',((extract(epoch from p_a.effective_at)*1000000)::bigint)::text,
   'input_digest',p_a.input_digest) || case when p_a.runtime_version=2 then jsonb_build_object('runtime_version',2,'input_original',p_a.input_original) else '{}'::jsonb end;
$$;

create or replace function app_private.funding_earned_snapshot(p_e app_private.funding_earned_receipts)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_e.user_id,'activation_id',p_e.activation_id,'cycle_id',p_e.cycle_id,
  'job_id',p_e.job_id,'attempt_number',p_e.attempt_number,'worker_id',p_e.worker_id,
  'fence_expires_at_microseconds',((extract(epoch from p_e.fence_expires_at)*1000000)::bigint)::text,
  'previous_state_id',p_e.previous_state_id,'next_state_id',p_e.next_state_id,
  'settled_from_microseconds',((extract(epoch from p_e.settled_from)*1000000)::bigint)::text,
  'settled_to_microseconds',((extract(epoch from p_e.settled_to)*1000000)::bigint)::text,'calculation',p_e.calculation,
  'credit_id',p_e.credit_id,'settlement_id',p_e.settlement_id) || case when p_e.runtime_version=2 then jsonb_build_object('runtime_version',2,'condition_id',p_e.condition_id,'cause_allocation_id',p_e.cause_allocation_id) else '{}'::jsonb end;
$$;

create or replace function app_private.guard_funding_activation() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_input jsonb; v_cycle app_private.funding_cycle_windows%rowtype;
begin
 if new.runtime_version=2 then perform app_private.validate_prospective_activation(new); return new; end if;
  v_input:=app_private.read_default_funding_inputs(new.trigger_credit_movement_id,new.allocation_original_id);
  select * into v_cycle from app_private.funding_cycle_windows where id=new.first_cycle_id;
  if new.user_id::text is distinct from v_input->>'user_id'
    or new.trigger_principal_revision_id::text is distinct from v_input->>'principal_revision_id'
    or new.policy_publication_id::text is distinct from v_input->>'policy_publication_id'
    or new.principal_atomic::text is distinct from v_input->>'principal_atomic'
    or ((extract(epoch from new.effective_at)*1000000)::bigint)::text is distinct from v_input->>'effective_at_microseconds'
    or new.input_digest is distinct from app_private.funding_engine_digest(v_input)
    or v_cycle.user_id is distinct from new.user_id or v_cycle.cycle_ordinal is distinct from 0
    or v_cycle.cycle_started_at is distinct from new.effective_at
    or v_cycle.cycle_days is distinct from (v_input->>'cycle_days')::integer then
    raise exception using errcode='55000',message='FUNDING_ACTIVATION_ORIGINAL_MISMATCH'; end if;
  return new;
end;
$$;

create or replace function app_private.guard_funding_state_receipt() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_a app_private.funding_engine_activations%rowtype; v_previous app_private.funding_engine_state_receipts%rowtype;
  v_earned app_private.funding_earned_receipts%rowtype; v_cycle app_private.funding_cycle_windows%rowtype;
begin
 if (select runtime_version from app_private.funding_engine_activations where id=new.activation_id)=2 then perform app_private.validate_prospective_state(new); return new; end if;
 if new.condition_id is not null then raise exception using errcode='55000',message='FUNDING_STATE_ORIGINAL_MISMATCH'; end if;
  select * into v_a from app_private.funding_engine_activations where id=new.activation_id;
  select * into v_cycle from app_private.funding_cycle_windows where id=new.cycle_id;
  if new.user_id is distinct from v_a.user_id or new.cycle_id is distinct from v_a.first_cycle_id
    or new.cursor_at<v_cycle.cycle_started_at or new.cursor_at>v_cycle.cycle_end
    or new.cycle_closed is distinct from (new.cursor_at=v_cycle.cycle_end)
    or app_private.funding_exact_ratio(new.base_used_num,new.base_used_den) is distinct from array[new.base_used_num,new.base_used_den]
    or app_private.funding_exact_ratio(new.retention_used_num,new.retention_used_den) is distinct from array[new.retention_used_num,new.retention_used_den]
    or app_private.funding_exact_ratio(new.carry_num,new.carry_den) is distinct from array[new.carry_num,new.carry_den] then
    raise exception using errcode='55000',message='FUNDING_STATE_ORIGINAL_MISMATCH'; end if;
  if new.revision=0 then
    if new.cursor_at<>v_a.effective_at or new.base_used_num<>0 or new.base_used_den<>1
      or new.retention_used_num<>0 or new.retention_used_den<>1 or new.carry_num<>0 or new.carry_den<>1 then
      raise exception using errcode='55000',message='FUNDING_STATE_INITIAL_MISMATCH'; end if;
  else
    select * into v_previous from app_private.funding_engine_state_receipts where id=new.previous_state_id;
    select * into v_earned from app_private.funding_earned_receipts where id=new.earned_receipt_id;
    if v_previous.user_id is distinct from new.user_id or v_previous.activation_id is distinct from new.activation_id
      or new.revision is distinct from v_previous.revision+1 or v_previous.cycle_closed
      or v_earned.next_state_id is distinct from new.id or v_earned.previous_state_id is distinct from v_previous.id
      or new.cursor_at is distinct from v_earned.settled_to
      or new.base_used_num::text is distinct from v_earned.calculation->>'baseUsedNum'
      or new.base_used_den::text is distinct from v_earned.calculation->>'baseUsedDen'
      or new.retention_used_num::text is distinct from v_earned.calculation->>'retentionUsedNum'
      or new.retention_used_den::text is distinct from v_earned.calculation->>'retentionUsedDen'
      or new.carry_num::text is distinct from v_earned.calculation->>'carryNum'
      or new.carry_den::text is distinct from v_earned.calculation->>'carryDen' then
      raise exception using errcode='55000',message='FUNDING_STATE_SUCCESSOR_MISMATCH'; end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_funding_earned_receipt() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_a app_private.funding_engine_activations%rowtype; v_state app_private.funding_engine_state_receipts%rowtype;
 v_j app_private.funding_engine_jobs%rowtype; v_cycle app_private.funding_cycle_windows%rowtype;
 v_input jsonb; v_calculation jsonb; v_until timestamptz;
begin
 if new.runtime_version=2 then perform app_private.validate_prospective_earned(new); return new; end if;
 if current_user<>'service_role' then raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||new.user_id::text,0));
 select * into v_a from app_private.funding_engine_activations where id=new.activation_id;
 select * into v_j from app_private.funding_engine_jobs where job_id=new.job_id;
 select * into v_state from app_private.funding_engine_state_receipts where id=new.previous_state_id;
 select * into v_cycle from app_private.funding_cycle_windows where id=new.cycle_id;
 perform app_private.assert_funding_job_fence(new.job_id,new.worker_id,new.attempt_number);
 v_input:=app_private.read_default_funding_inputs(v_a.trigger_credit_movement_id,v_a.allocation_original_id);
 select effective_until into v_until from app_private.economy_policy_published where publication_id=v_a.policy_publication_id;
 if v_a.user_id is distinct from new.user_id or v_j.user_id is distinct from new.user_id
   or v_j.activation_id is distinct from new.activation_id or v_j.expected_state_id is distinct from new.previous_state_id
   or v_state.id is distinct from (select id from app_private.funding_engine_state where user_id=new.user_id)
   or v_state.activation_id is distinct from v_a.id or v_state.cycle_closed
   or new.fence_expires_at is distinct from (select lease_expires_at from public.system_jobs where id=new.job_id)
   or new.cycle_id is distinct from v_a.first_cycle_id or new.settled_from is distinct from v_state.cursor_at
   or new.settled_to>clock_timestamp() or new.settled_to>v_cycle.cycle_end
   or (v_until is not null and new.settled_to>v_until)
   or v_a.input_digest is distinct from app_private.funding_engine_digest(v_input) then
   raise exception using errcode='55000',message='FUNDING_EARNED_INPUT_MISMATCH'; end if;
 v_calculation:=app_private.funding_exact_default_interval(v_a.principal_atomic,
   (v_input->>'base_bps')::integer,(v_input->>'retention_bps')::integer,(v_input->>'allocation_bps')::integer,
   (extract(epoch from v_cycle.cycle_end-v_cycle.cycle_started_at)*1000000)::bigint,
   (extract(epoch from new.settled_to-new.settled_from)*1000000)::bigint,
   v_state.base_used_num,v_state.base_used_den,v_state.retention_used_num,v_state.retention_used_den,
   v_state.carry_num,v_state.carry_den,new.settled_to=v_cycle.cycle_end);
 if new.calculation is distinct from v_calculation or new.amount_atomic::text is distinct from v_calculation->>'amountAtomic'
   or new.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_earned_snapshot(new)) then
   raise exception using errcode='55000',message='FUNDING_EARNED_CALCULATION_MISMATCH'; end if;
 return new;
end;
$$;

create or replace function app_private.verify_funding_engine_fact_complete() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_snapshot jsonb; v_kind text; v_user uuid; v_id uuid; v_digest text; v_audit uuid; v_event uuid;
 v_e app_private.funding_earned_receipts%rowtype; v_move public.money_source_movements%rowtype;
begin
 if tg_table_name='funding_engine_activations' then
  if new.runtime_version=2 then perform app_private.verify_prospective_activation(new); return null; end if;
 end if;
 if tg_table_name='funding_earned_receipts' then
  if new.runtime_version=2 then perform app_private.verify_prospective_earned(new); return null; end if;
 end if;
 if tg_table_name='funding_engine_activations' then
   v_id:=new.id;
   v_snapshot:=app_private.funding_activation_snapshot(new); v_kind:='FUNDING_ACTIVATED';
   if not exists(select 1 from app_private.funding_engine_state_receipts where activation_id=new.id and revision=0) then
     raise exception using errcode='55000',message='FUNDING_INITIAL_STATE_MISSING'; end if;
 elsif tg_table_name='funding_engine_jobs' then
   v_id:=new.job_id;
   v_snapshot:=app_private.funding_job_snapshot(new); v_kind:='FUNDING_JOB_PREPARED';
 else
   v_id:=new.id;
   v_e:=new; v_snapshot:=app_private.funding_earned_snapshot(v_e); v_kind:='FUNDING_EARNED_ACCEPTED';
   if not exists(select 1 from public.system_jobs job join public.system_job_attempts attempt
       on attempt.job_id=job.id and attempt.attempt_number=job.attempts
     where job.id=v_e.job_id and job.status='SUCCEEDED' and job.attempts=v_e.attempt_number
       and attempt.worker_id=v_e.worker_id and attempt.status='SUCCEEDED'
       and job.completed_at=attempt.completed_at and job.completed_at>=v_e.recorded_at
       and job.completed_at<v_e.fence_expires_at and job.completed_at<=clock_timestamp()) then
     raise exception using errcode='55000',message='FUNDING_ACCEPTED_JOB_COMPLETION_MISSING'; end if;
   if not exists(select 1 from app_private.funding_engine_state_receipts where id=v_e.next_state_id
       and earned_receipt_id=v_e.id and user_id=v_e.user_id) then
     raise exception using errcode='55000',message='FUNDING_EARNED_SUCCESSOR_MISSING'; end if;
   if v_e.amount_atomic>0 then
     select movement.* into v_move from public.money_source_movements movement
     join public.mining_reward_credits credit on credit.ledger_transaction_id=movement.ledger_transaction_id
     where credit.id=v_e.credit_id and credit.funding_earned_receipt_id=v_e.id;
     if v_move.user_id is distinct from v_e.user_id or v_move.amount_atomic is distinct from v_e.amount_atomic
       or v_move.source_bucket is distinct from 'MINING_REWARD' or v_move.movement_kind is distinct from 'CREDIT'
       or v_move.effective_at is distinct from v_e.settled_to
       or not exists(select 1 from public.mining_settlement_segments where funding_earned_receipt_id=v_e.id) then
       raise exception using errcode='55000',message='FUNDING_EARNED_POST_INCOMPLETE'; end if;
     perform app_private.assert_money_source_credit(v_move);
   end if;
   if (v_e.calculation->>'qualifiedRetentionNum')::numeric>0
     and not exists(select 1 from app_private.funding_retention_qualifications where earned_receipt_id=v_e.id) then
     raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 end if;
 v_user:=new.user_id; v_digest:=new.input_digest; v_audit:=new.audit_id; v_event:=new.source_event_id;
 perform app_private.assert_funding_engine_seal(v_id,v_kind,v_user,v_digest,v_audit,v_event,v_snapshot);
 return null;
end;
$$;

create or replace function app_private.guard_funded_canonical_insert() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_e app_private.funding_earned_receipts%rowtype; v_settlement public.mining_settlements%rowtype;
begin
 if new.funding_earned_receipt_id is null then
   if current_user='service_role' then raise exception using errcode='42501',message='FUNDING_EARNED_ORIGINAL_REQUIRED'; end if;
   return new; -- Preserve immutable owner-only legacy fixtures/history.
 end if;
 select * into v_e from app_private.funding_earned_receipts where id=new.funding_earned_receipt_id;
 if v_e.id is null or new.user_id is distinct from v_e.user_id or new.amount_atomic is distinct from v_e.amount_atomic or v_e.amount_atomic<=0 then
   raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 if tg_table_name='mining_reward_credits' then
   if new.id is distinct from v_e.credit_id or new.effective_at is distinct from v_e.settled_to then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 elsif tg_table_name='mining_settlements' then
   if new.id is distinct from v_e.settlement_id or new.settled_from is distinct from v_e.settled_from
     or new.settled_to is distinct from v_e.settled_to or new.currency<>'KRW' or new.segment_count<>1
     or new.idempotency_key is distinct from (case when v_e.cause_allocation_id is not null then 'funding:allocation:'||v_e.cause_allocation_id::text||':settlement' else 'funding:job:'||v_e.job_id::text||':settlement' end) then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 else
   select * into v_settlement from public.mining_settlements where id=new.mining_settlement_id;
   if v_settlement.funding_earned_receipt_id is distinct from v_e.id or new.sequence<>0
     or new.settled_from is distinct from v_e.settled_from or new.settled_to is distinct from v_e.settled_to
     or new.equipment_efficiency_bps<>10000 or new.world_multiplier_bps<>10000
     or new.event_multiplier_bps<>10000 or new.status_multiplier_bps<>10000 then
     raise exception using errcode='55000',message='FUNDING_CANONICAL_POST_MISMATCH'; end if;
 end if;
 return new;
end;
$$;
-- Future job preparation is still dormant and the V1 monetary consumer cannot
-- use a V2 activation as if its changing condition were the initial input.
create function app_private.guard_funding_runtime_job_scope() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if (select runtime_version from app_private.funding_engine_activations where id=new.activation_id)=2 then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_JOB_ADAPTER_REQUIRED'; end if;
 return new;
end;
$$;
create trigger a_funding_runtime_job_scope before insert on app_private.funding_engine_jobs
 for each row execute function app_private.guard_funding_runtime_job_scope();

-- Condition seal events carry immutable originals just like existing engine
-- events, while operational delivery metadata remains mutable.
create function app_private.guard_funding_condition_event() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if exists(select 1 from app_private.funding_condition_originals where source_event_id=old.id)
  and(tg_op='DELETE' or to_jsonb(new)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
    is distinct from to_jsonb(old)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']) then
  raise exception using errcode='55000',message='FUNDING_OPERATIONAL_ORIGINAL_IMMUTABLE'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger funding_condition_event_immutable before update or delete on public.outbox_events
 for each row execute function app_private.guard_funding_condition_event();

do $close_new_functions$
declare f record;
begin
 for f in select oid::regprocedure identity from pg_proc where pronamespace='app_private'::regnamespace
  and proname in('assert_funding_member_writer','assert_prospective_allocation','read_prospective_funding_inputs',
   'funding_condition_snapshot','guard_funding_condition','funding_exact_condition_interval',
   'validate_prospective_activation','validate_prospective_state','validate_prospective_earned',
   'verify_prospective_activation','assert_allocation_boundary_complete','verify_prospective_earned',
   'verify_funding_condition_complete','guard_funding_runtime_job_scope','guard_funding_condition_event') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity);
  execute format('grant execute on function %s to service_role',f.identity);
 end loop;
end;
$close_new_functions$;
commit;
