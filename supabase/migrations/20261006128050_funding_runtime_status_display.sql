begin;

-- Read-only accepted receipt + exact preview DTO. A private definer supplies
-- revoked catalog-source read privileges only after independently requiring the
-- actual service SQL role/JWT role and a matching subject when present. The
-- canonical public RPC remains invoker and exposes no arbitrary private reads.
create or replace function app_private.read_funding_runtime_server_display(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 cycle app_private.funding_cycle_windows%rowtype; policy app_private.economy_policy_published%rowtype;
 instant timestamptz; inputs jsonb; calculation jsonb; tier jsonb; pending numeric[]; maintenance numeric[];
 used numeric[]; capacity numeric[]; remaining numeric[]; committed numeric;
 speed numeric[]; runtime_status text; stop_reason text; base_capacity numeric[];
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role'
  or p_user is null or(auth.uid() is not null and auth.uid() is distinct from p_user) then
  raise exception using errcode='42501',message='MINING_DISPLAY_SUBJECT_FORBIDDEN'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 select * into activation from app_private.funding_engine_activations where user_id=p_user;
 select * into state from app_private.funding_engine_state where user_id=p_user;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 instant:=clock_timestamp();
 if activation.runtime_version is distinct from 2 or state.activation_id is distinct from activation.id
  or state.user_id is distinct from p_user or condition.user_id is distinct from p_user
  or condition.activation_id is distinct from activation.id or cycle.id is distinct from activation.first_cycle_id
  or state.cycle_closed or instant>=cycle.cycle_end or instant<state.cursor_at then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_DISPLAY_BOUNDARY_UNSUPPORTED'; end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',p_user,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',p_user,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,instant);
 if inputs is distinct from condition.inputs
  or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition))
  or not exists(select 1 from app_private.funding_portion_clock_state c
    join app_private.funding_principal_portions p on p.id=c.portion_id
    join public.funding_principal_lots l on l.id=p.lot_id
    where c.user_id=p_user and c.status='AVAILABLE' and p.parent_portion_id is null
     and p.amount_micro_krw=l.amount_micro_krw and l.money_source_movement_id=activation.trigger_credit_movement_id)
  or(select count(*) from app_private.funding_portion_clock_state where user_id=p_user)<>1 then
  raise exception using errcode='55000',message='FUNDING_RUNTIME_DISPLAY_ORIGINAL_MISMATCH'; end if;
 if condition.allocation_original_id is not null then
  perform app_private.assert_allocation_boundary_complete(condition.allocation_original_id,condition.id);
 end if;
 calculation:=app_private.funding_exact_condition_interval((inputs->>'principal_atomic')::bigint,
  (inputs->>'base_bps')::integer,(inputs->>'retention_bps')::integer,(inputs->>'allocation_bps')::integer,
  (extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint,
  (extract(epoch from instant-state.cursor_at)*1000000)::bigint,
  state.base_used_num,state.base_used_den,state.retention_used_num,state.retention_used_den,state.carry_num,state.carry_den,false);
 pending:=app_private.funding_exact_sum(array[state.carry_num,state.carry_den],
  array[(calculation->>'baseNum')::numeric,(calculation->>'baseDen')::numeric]);
 maintenance:=array[(calculation->>'retentionUsedNum')::numeric,(calculation->>'retentionUsedDen')::numeric];
 used:=app_private.funding_exact_sum(array[(calculation->>'baseUsedNum')::numeric,(calculation->>'baseUsedDen')::numeric],maintenance);
 capacity:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*
  ((inputs->>'base_bps')::numeric+(inputs->>'retention_bps')::numeric),10000);
 remaining:=app_private.funding_exact_ratio(greatest(0,capacity[1]*used[2]-used[1]*capacity[2]),capacity[2]*used[2]);
 select * into policy from app_private.economy_policy_published where publication_id=activation.policy_publication_id;
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::bigint<=(inputs->>'principal_atomic')::bigint
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::bigint>=(inputs->>'principal_atomic')::bigint);
 speed:=app_private.funding_exact_ratio((inputs->>'allocation_bps')::numeric,10000);
 base_capacity:=app_private.funding_exact_ratio((inputs->>'principal_atomic')::numeric*(inputs->>'base_bps')::numeric,10000);
 if (inputs->>'allocation_bps')::integer=0 then
  runtime_status:='STOPPED'; stop_reason:='NO_ACTIVE_ALLOCATION';
 elsif (calculation->>'baseUsedNum')::numeric*base_capacity[2]>=base_capacity[1]*(calculation->>'baseUsedDen')::numeric then
  runtime_status:='STOPPED'; stop_reason:='CAPACITY_USED';
 else runtime_status:='ACTIVE'; end if;
 select coalesce(sum(amount_atomic),0) into committed from app_private.funding_earned_receipts where activation_id=activation.id;
 return jsonb_build_object('available',true,'eligible_principal_micro_krw',
  ((inputs->>'principal_atomic')::numeric*1000000)::text,'tier_code',tier->>'code','tier_activated',true,
  'cycle_started_at',to_char(cycle.cycle_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'cycle_end',to_char(cycle.cycle_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'effective_capacity_micro_krw',div(capacity[1]*1000000,capacity[2])::text,
  'remaining_capacity_micro_krw',div(remaining[1]*1000000,remaining[2])::text,
  'used_capacity_micro_krw',div(used[1]*1000000,used[2])::text,'speed_multiplier_bps','10000',
  'pending_micro_krw',div(pending[1]*1000000,pending[2])::text,
  'retention_unconfirmed_micro_krw',div(maintenance[1]*1000000,maintenance[2])::text,
  'funded_runtime',jsonb_build_object('schema_version',2,'runtime_version',2,'state_revision',state.revision::text,
   'condition_revision',condition.revision::text,
   'accepted_cursor_at',to_char(state.cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'evaluated_at',to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'allocation_bps',inputs->>'allocation_bps','status',runtime_status,'stop_reason',stop_reason,
   'speed',jsonb_build_object('product_multiplier_bps','10000','user_multiplier_bps','10000',
    'common_multiplier',jsonb_build_object('numerator','1','denominator','1'),
    'effective_global_multiplier',jsonb_build_object('numerator',speed[1]::text,'denominator',speed[2]::text)),
   'committed_reward_total_atomic',committed::text,
   'reward_carry',jsonb_build_object('numerator',state.carry_num::text,'denominator',state.carry_den::text,'unit','KRW'),
   'conditional_maintenance',jsonb_build_object('numerator',maintenance[1]::text,'denominator',maintenance[2]::text,
    'unit','KRW','qualification','UNCONFIRMED')));
end;
$$;
-- Existing owner, service-only ACL and original-bound unsupported-case rejection are unchanged.
-- Status describes permitted BASE accrual at evaluated_at, never a job heartbeat.
-- Neutral intrinsic speed is independent of allocation; effective global speed
-- is an exact server ratio. All approved weighted-before-global-cap math stays.
commit;
