begin;

create or replace function app_private.read_principal_input3_prefinance_current_inputs(p_user uuid,p_allocation uuid,p_at timestamptz,p_withdrawal uuid,p_admission uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare movement public.money_source_movements%rowtype; principal public.funding_principal_revisions%rowtype;
 policy app_private.economy_policy_published%rowtype; receipt app_private.economy_policy_receipts%rowtype;
 policy_revision integer:=0; previous uuid; tier jsonb; allocation_bps integer:=0;
 first_credit_at timestamptz; manifest jsonb:='[]'::jsonb; recovery_manifest jsonb:='[]'::jsonb;
 portion_manifest jsonb:='[]'::jsonb; source record; credits bigint;
 intent app_private.funding_principal_recovery_intent_originals%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 transition app_private.funding_portion_transitions%rowtype;
 previous_transition app_private.funding_portion_transitions%rowtype;
 clock app_private.funding_portion_clock_receipts%rowtype;
 allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype;
 available_micro numeric:=0; held_micro numeric:=0; gross_micro numeric:=0;
 expected_available numeric; expected_held numeric;
 current_condition app_private.funding_condition_originals%rowtype;
 accepted_state uuid;
 archive_boundary uuid; archive_last_revision bigint; result jsonb;
begin
 perform app_private.assert_principal_input_executor(p_user);
 if p_at is null or not isfinite(p_at) or p_at>clock_timestamp() then
  raise exception using errcode='22023',message='FUNDING_PRINCIPAL_INPUT_TIME_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 -- Only this exact, still unfinanced REQUESTED row is excluded. The original
 -- public reader and every native postfinance/deferred COMPLETE guard remain.
 if p_admission is null then
  if not app_private.principal_intent_prefinance_coverage_verified(p_user,p_withdrawal) then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_SOURCE_UNRESOLVED';end if;
 else
  if p_at is distinct from(select a.effective_at from app_private.funding_withdrawal_clock_admissions a
    where a.id=p_admission and a.user_id=p_user and a.withdrawal_id=p_withdrawal and a.phase='HOLD')
   or not app_private.principal_boundary_prefinance_coverage_verified(p_user,p_withdrawal,p_admission) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT3_ADMISSION_REQUIRED';end if;
 end if;
 select c.* into current_condition from app_private.funding_engine_state s
  join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=p_user;
 archive_boundary:=current_condition.id;
 accepted_state:=app_private.input3_condition_accepted_state(current_condition.id);
 if current_condition.user_id is distinct from p_user
  or current_condition.inputs->>'input_contract_version' is distinct from '3'
  or coalesce(current_condition.current_allocation_original_id,current_condition.allocation_original_id) is distinct from p_allocation
  or current_condition.effective_at>p_at or accepted_state is null
  or not exists(select 1 from app_private.funding_engine_state_receipts accepted
    join app_private.funding_engine_state current_state on current_state.user_id=accepted.user_id
    where accepted.id=accepted_state and accepted.user_id=p_user
     and accepted.condition_id=current_condition.id and accepted.activation_id=current_state.activation_id
     and accepted.cycle_id=current_state.cycle_id and accepted.revision<=current_state.revision
     and not current_state.cycle_closed) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT3_CURRENT_BOUNDARY_REQUIRED';end if;
 perform app_private.assert_input3_condition_snapshot(archive_boundary);
 archive_last_revision:=app_private.input3_snapshot_last_transition(archive_boundary);
 if archive_last_revision is distinct from(select max(t.revision) from app_private.funding_portion_transitions t where t.user_id=p_user) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT3_CURRENT_PORTION_REQUIRED';end if;
 if current_condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(current_condition)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT3_CONDITION_ORIGINAL_REQUIRED';end if;
 perform app_private.assert_funding_engine_seal(current_condition.id,'FUNDING_CONDITION_CHANGED',p_user,
  current_condition.input_digest,current_condition.audit_id,current_condition.source_event_id,app_private.funding_condition_snapshot(current_condition));
 if exists(select 1 from app_private.funding_cycle_segments s where s.user_id=p_user)
  or exists(select 1 from public.money_source_movements m where m.user_id=p_user and
   ((m.source_bucket='PRINCIPAL' and(m.movement_kind<>'CREDIT' or m.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT')))
    or m.origin_code='PRINCIPAL_RECOVERY_FINALIZE'))
  or exists(select 1 from app_private.funding_portion_transitions t where t.user_id=p_user and(t.kind='FINALIZE' or t.effective_at>p_at)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_SOURCE_UNRESOLVED'; end if;
 select count(*) into credits from public.money_source_movements m where m.user_id=p_user and m.source_bucket='PRINCIPAL';
 if credits=0 or credits<>(select count(*) from public.funding_principal_lots l where l.user_id=p_user)
  or credits<>(select count(*) from public.funding_principal_revisions r where r.user_id=p_user and r.direction='INCREASE') then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CREDIT_ORIGINAL_MISMATCH'; end if;
 -- Validate every genuine immutable CREDIT against authoritative net as-of
 -- eligibility. Never relabel or repair a historical gross-after revision.
 for source in select m.id as movement_id,l.id as lot_id,r.id as principal_revision_id
  from public.money_source_movements m join public.funding_principal_lots l on l.money_source_movement_id=m.id
  join public.funding_principal_revisions r on r.money_source_movement_id=m.id
  where m.user_id=p_user and m.source_bucket='PRINCIPAL' order by m.effective_at,m.id loop
  select m.* into movement from public.money_source_movements m where m.id=source.movement_id;
  select r.* into principal from public.funding_principal_revisions r where r.id=source.principal_revision_id;
  if movement.effective_at>p_at or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or principal.user_id is distinct from p_user or principal.direction is distinct from 'INCREASE'
   or principal.effective_at is distinct from movement.effective_at
   or principal.ledger_transaction_id is distinct from movement.ledger_transaction_id
   or principal.source_event_id is distinct from movement.source_event_id
   or principal.delta_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
   or principal.hold_ledger_transaction_id is not null
   or principal.eligible_principal_micro_krw_after is distinct from
    app_private.funding_principal_mining_eligible_micro(p_user,movement.effective_at)
   or not exists(select 1 from public.funding_principal_lots l where l.id=source.lot_id and l.user_id=p_user
    and l.money_source_movement_id=movement.id and l.ledger_transaction_id=movement.ledger_transaction_id
    and l.source_event_id=movement.source_event_id and l.effective_at=movement.effective_at
    and l.amount_atomic=movement.amount_atomic and l.amount_micro_krw=principal.delta_micro_krw)
   or not exists(select 1 from app_private.funding_principal_portions p
    join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
    where p.user_id=p_user and p.lot_id=source.lot_id and p.parent_portion_id is null
     and p.amount_micro_krw=principal.delta_micro_krw and t.kind='CREDIT' and t.original_id=source.lot_id
     and t.effective_at=movement.effective_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CREDIT_ORIGINAL_MISMATCH'; end if;
  perform app_private.assert_money_source_credit(movement);
  gross_micro:=gross_micro+principal.delta_micro_krw;
  first_credit_at:=least(first_credit_at,movement.effective_at);
  manifest:=manifest||jsonb_build_array(jsonb_build_object('credit_id',movement.id,'lot_id',source.lot_id,
   'principal_revision_id',principal.id,'amount_atomic',movement.amount_atomic::text,
   'effective_at_microseconds',((extract(epoch from movement.effective_at)*1000000)::bigint)::text));
 end loop;
 if jsonb_array_length(manifest)<>credits then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CREDIT_ORIGINAL_MISMATCH'; end if;
 -- CURRENT hold/release evidence is a genuine130 journal, closed131 type and
 -- complete native command. Metadata or a historical unbound recovery is not
 -- accepted as an input3 authority.
 for source in select m.id as movement_id from public.money_source_movements m where m.user_id=p_user
  and m.origin_code in('PRINCIPAL_RECOVERY_HOLD','PRINCIPAL_RECOVERY_RELEASE') order by m.effective_at,m.id loop
  select m.* into movement from public.money_source_movements m where m.id=source.movement_id;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a
   join public.withdrawal_requests r on r.id=a.withdrawal_id
   where a.user_id=p_user and a.phase=(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' else 'RELEASE' end)
    and movement.ledger_transaction_id=(case when a.phase='HOLD' then r.hold_ledger_transaction_id else r.release_ledger_transaction_id end);
  select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
  if admission.id is null or intent.user_id is distinct from p_user or movement.effective_at is distinct from admission.effective_at
   or movement.effective_at>p_at or movement.amount_atomic is distinct from admission.amount_atomic then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RECOVERY_ORIGINAL_REQUIRED'; end if;
  perform app_private.assert_principal_recovery_intent_completion(intent.id);
  perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
  perform app_private.assert_principal_recovery_movement(movement);
  recovery_manifest:=recovery_manifest||jsonb_build_array(jsonb_build_object('movement_id',movement.id,
   'origin_code',movement.origin_code,'intent_id',intent.id,'clock_admission_id',admission.id,
   'ledger_transaction_id',movement.ledger_transaction_id,'source_event_id',movement.source_event_id,
   'amount_atomic',movement.amount_atomic::text,
   'effective_at_microseconds',((extract(epoch from movement.effective_at)*1000000)::bigint)::text));
 end loop;
 for allocation in select a.* from public.funding_principal_recovery_allocations a where a.user_id=p_user loop
  select r.* into principal from public.funding_principal_revisions r where r.user_id=p_user
   and r.hold_ledger_transaction_id=allocation.hold_ledger_transaction_id and r.lot_id=allocation.lot_id;
  if allocation.policy_code is distinct from 'NEWEST_FIRST' or principal.id is null
   or principal.direction is distinct from 'DECREASE' or principal.money_source_movement_id is not null
   or principal.ledger_transaction_id is distinct from allocation.hold_ledger_transaction_id
   or principal.delta_micro_krw is distinct from allocation.allocation_micro_krw
   or principal.effective_at is distinct from allocation.effective_at or allocation.effective_at>p_at
   or principal.source_event_id is distinct from(select m.source_event_id from public.money_source_movements m
    where m.ledger_transaction_id=allocation.hold_ledger_transaction_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD' and m.user_id=p_user)
   or principal.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(p_user,allocation.effective_at)
   or not exists(select 1 from public.money_source_movements m where m.ledger_transaction_id=allocation.hold_ledger_transaction_id
    and m.user_id=p_user and m.origin_code='PRINCIPAL_RECOVERY_HOLD')
   or not exists(select 1 from app_private.funding_portion_transitions t where t.kind='HOLD' and t.original_id=allocation.id and t.user_id=p_user) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RECOVERY_REVISION_MISMATCH'; end if;
 end loop;
 if(select count(*) from public.funding_principal_revisions r where r.user_id=p_user and r.direction='DECREASE')
   <>(select count(*) from public.funding_principal_recovery_allocations a where a.user_id=p_user) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RECOVERY_REVISION_MISMATCH'; end if;
 for release in select r.* from public.funding_principal_recovery_releases r where r.user_id=p_user loop
  if not exists(select 1 from public.money_source_movements m where m.ledger_transaction_id=release.release_ledger_transaction_id
    and m.user_id=p_user and m.origin_code='PRINCIPAL_RECOVERY_RELEASE' and m.effective_at=release.effective_at)
   or not exists(select 1 from app_private.funding_portion_transitions t where t.kind='RELEASE'
    and t.original_id=release.id and t.user_id=p_user and t.effective_at=release.effective_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RELEASE_ORIGINAL_MISSING'; end if;
 end loop;
 -- Independently replay the contiguous transition and per-portion clock chain.
 for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=p_user order by t.revision loop
  if transition.revision is distinct from coalesce(previous_transition.revision,0)+1
   or transition.previous_transition_id is distinct from previous_transition.id
   or(previous_transition.id is not null and transition.effective_at<previous_transition.effective_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PORTION_CHAIN_MISMATCH'; end if;
  perform app_private.verify_input3_history_portion_fact(transition,archive_boundary);
  previous_transition:=transition;
 end loop;
 for clock in select c.* from app_private.funding_portion_clock_receipts c where c.user_id=p_user loop
  perform app_private.assert_input3_history_clock_original(clock.id,archive_boundary);
 end loop;
 for source in select p.*,c.id as clock_id,c.status,c.effective_at as clock_at,c.accumulated_eligible_microseconds,
   c.resumed_at,c.hold_allocation_id,c.transition_id,c.revision as clock_revision
  from app_private.funding_principal_portions p join app_private.funding_portion_clock_state c on c.portion_id=p.id
  where p.user_id=p_user order by p.id loop
  if source.status='AVAILABLE' then available_micro:=available_micro+source.amount_micro_krw;
  elsif source.status='HELD' then held_micro:=held_micro+source.amount_micro_krw;
  elsif source.status<>'SPLIT' then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PORTION_STATUS_UNSUPPORTED'; end if;
  portion_manifest:=portion_manifest||jsonb_build_array(jsonb_build_object('portion_id',source.id,
   'lot_id',source.lot_id,'parent_portion_id',source.parent_portion_id,'amount_micro_krw',source.amount_micro_krw::text,
   'clock_id',source.clock_id,'clock_revision',source.clock_revision::text,'transition_id',source.transition_id,
   'status',source.status,'clock_at_microseconds',((extract(epoch from source.clock_at)*1000000)::bigint)::text,
   'accumulated_eligible_microseconds',source.accumulated_eligible_microseconds::text,
   'resumed_at_microseconds',(case when source.resumed_at is null then null else ((extract(epoch from source.resumed_at)*1000000)::bigint)::text end),
   'hold_allocation_id',source.hold_allocation_id));
 end loop;
 expected_available:=app_private.funding_principal_mining_eligible_micro(p_user,p_at);
 expected_held:=gross_micro-expected_available;
 if available_micro is distinct from expected_available or held_micro is distinct from expected_held
  or available_micro+held_micro is distinct from gross_micro or mod(available_micro,1000000)<>0
  or available_micro>9223372036854775807
  or jsonb_array_length(portion_manifest)<>(select count(*) from app_private.funding_principal_portions p where p.user_id=p_user)
  or available_micro/1000000 is distinct from(current_condition.inputs->>'principal_atomic')::numeric
  or held_micro/1000000 is distinct from(current_condition.inputs->>'held_principal_atomic')::numeric then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PORTION_CONSERVATION_REQUIRED'; end if;
 movement.amount_atomic:=div(available_micro,1000000)::bigint;
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
 result:=jsonb_build_object('input_contract_version',3,'user_id',p_user,'credit_originals',manifest,
  'principal_original_digest',app_private.funding_engine_digest(manifest),'recovery_originals',recovery_manifest,
  'recovery_original_digest',app_private.funding_engine_digest(recovery_manifest),
  'portion_clock_originals',portion_manifest,'portion_clock_original_digest',app_private.funding_engine_digest(portion_manifest),
  'principal_atomic',movement.amount_atomic::text,'held_principal_atomic',div(held_micro,1000000)::bigint::text,
  'first_credit_at_microseconds',((extract(epoch from first_credit_at)*1000000)::bigint)::text,
  'allocation_id',p_allocation,'allocation_digest',(select a.input_digest from app_private.funding_allocation_originals a where a.id=p_allocation),
  'allocation_bps',allocation_bps,'policy_publication_id',policy.publication_id,'policy_config_digest',policy.config_digest,
  'policy_effective_from_microseconds',((extract(epoch from policy.effective_from)*1000000)::bigint)::text,
  'cycle_days',(policy.config->>'cycleDays')::integer,'base_bps',(policy.config->>'baseCycleRateBps')::integer,
  'retention_bps',coalesce((tier->>'retentionBonusBps')::integer,0),'tier_code',tier->>'code',
  'slots',coalesce((tier->>'slots')::integer,0),'tier_activated',tier is not null);
 -- Fresh policy/allocation and every current source/portion/clock are computed
 -- independently above, then matched to the previous completed condition.
 -- No new observation time, age or credit/hold fact is appended to that input.
 if result is distinct from current_condition.inputs then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT3_CURRENT_INPUTS_CHANGED';end if;
 return result;
end;
$$;

create or replace function app_private.prepare_principal_recovery_intent(p_withdrawal uuid,p_journal_request uuid) returns uuid
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
   and a.user_id=owner_id and a.runtime_version=2) or coalesce(condition.inputs->>'input_contract_version','') not in('2','3')
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
 if condition.inputs->>'input_contract_version'='3' then
  inputs:=app_private.read_principal_input3_prefinance_current_inputs(owner_id,original.current_allocation_original_id,
   original.prepared_at,request.id,null);
 else
  inputs:=app_private.read_principal_intent_current_inputs(owner_id,original.current_allocation_original_id,original.prepared_at,request.id);
 end if;
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
  if condition.inputs->>'input_contract_version'='3' then
   perform app_private.verify_input3_history_portion_fact(transition,condition.id);
  else
   perform app_private.verify_principal_prefinance_portion_fact(transition,request.id);
  end if;
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

create or replace function app_private.read_principal_prefinance_old_inputs(p_admission uuid,p_state uuid) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype;
 intent app_private.funding_principal_recovery_intent_originals%rowtype;
 state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype;
 transition app_private.funding_portion_transitions%rowtype; inputs jsonb; allocation_id uuid;
begin
 perform app_private.assert_principal_admission_before_finance(p_admission);
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=p_admission;
 select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
 select s.* into state from app_private.funding_engine_state_receipts s where s.id=p_state;
 select c.* into condition from app_private.funding_condition_originals c where c.id=state.condition_id;
 if intent.user_id is distinct from admission.user_id or state.user_id is distinct from admission.user_id
  or state.id is distinct from(select s.id from app_private.funding_engine_state s where s.user_id=admission.user_id)
  or state.cycle_closed or condition.user_id is distinct from admission.user_id then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_PREFINANCE_STATE_STALE'; end if;
 allocation_id:=coalesce(condition.current_allocation_original_id,condition.allocation_original_id);
 if admission.phase='HOLD' then
  if intent.previous_state_id is distinct from state.id or intent.journal_request_id is distinct from admission.journal_request_id
   or intent.amount_atomic is distinct from admission.amount_atomic or intent.prepared_at>admission.effective_at
   or intent.previous_condition_id is distinct from condition.id
   or intent.current_allocation_original_id is distinct from allocation_id
   or intent.source_inputs is distinct from condition.inputs
   or intent.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(intent)) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_TYPED_PREDECESSOR_MISMATCH'; end if;
  perform app_private.assert_funding_engine_seal(intent.id,'FUNDING_PRINCIPAL_RECOVERY_INTENT_TYPED',intent.user_id,
   intent.input_digest,intent.audit_id,intent.source_event_id,app_private.funding_principal_recovery_intent_snapshot(intent));
  if condition.inputs->>'input_contract_version'='3' then
   inputs:=app_private.read_principal_input3_prefinance_current_inputs(admission.user_id,allocation_id,
    admission.effective_at,admission.withdrawal_id,admission.id);
   for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=admission.user_id order by t.revision loop
    perform app_private.verify_input3_history_portion_fact(transition,condition.id);
   end loop;
  else
   inputs:=app_private.read_principal_boundary_current_inputs(admission.user_id,allocation_id,admission.effective_at,admission.withdrawal_id,admission.id);
   for transition in select t.* from app_private.funding_portion_transitions t where t.user_id=admission.user_id order by t.revision loop
    perform app_private.verify_principal_boundary_prefinance_portion_fact(transition,admission.withdrawal_id,admission.id);
   end loop;
  end if;
 else
  perform app_private.assert_principal_recovery_intent_completion(intent.id);
  if condition.inputs->>'input_contract_version' is distinct from '3'
   or app_private.input3_condition_accepted_state(condition.id) is null then
   -- A historical authority-only HOLD must not gain retrospective earning.
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_HISTORY_BOUNDARY_UNRESOLVED'; end if;
  inputs:=app_private.read_verified_input3_funding_inputs(admission.user_id,allocation_id,admission.effective_at);
 end if;
 if inputs is distinct from condition.inputs
  or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_OLD_CONDITION_CHANGED'; end if;
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',condition.user_id,
  condition.input_digest,condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 return inputs;
end;
$$;

create or replace function app_private.assert_principal_recovery_intent_completion(p_intent uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_principal_recovery_intent_originals%rowtype;
 request public.withdrawal_requests%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
 state app_private.funding_engine_state_receipts%rowtype; condition app_private.funding_condition_originals%rowtype;
 movement public.money_source_movements%rowtype; transition app_private.funding_portion_transitions%rowtype;
 previous_transition app_private.funding_portion_transitions%rowtype; allocation record;
 total_micro numeric:=0; last_revision bigint; boundary_id uuid;
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
  or coalesce(original.source_inputs->>'input_contract_version','') not in('2','3')
  or original.source_epoch_at is distinct from (select introduced_at from app_private.money_source_epochs where version=1)
  or original.principal_epoch_at is distinct from (select introduced_at from app_private.funding_principal_epochs where version=1)
  or original.engine_epoch_at is distinct from (select introduced_at from app_private.funding_engine_epochs where version=1)
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(original)) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_ORIGINAL_MISMATCH'; end if;
 if original.source_inputs->>'input_contract_version'='3' then
  if app_private.input3_condition_accepted_state(condition.id) is null
   or previous_transition.revision is distinct from app_private.input3_snapshot_last_transition(condition.id) then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_INPUT3_PREDECESSOR_REQUIRED';end if;
  -- Replay exact original condition cause and all archived source/portion
  -- proofs. CREDIT/ALLOCATION may not be mislabeled as PRINCIPAL.
  perform app_private.assert_input3_condition_snapshot(condition.id);
 end if;
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
 select b.id into boundary_id from app_private.funding_principal_boundary_preparations b
  join app_private.funding_principal_boundary_completions c on c.boundary_id=b.id
  where b.intent_id=original.id and b.clock_admission_id=admission.id and b.phase='HOLD'
   and b.previous_state_id=state.id and b.user_id=original.user_id and c.runtime_outcome='ACCEPTED';
 last_revision:=previous_transition.revision;
 for allocation in select a.* from public.funding_principal_recovery_allocations a
  where a.hold_ledger_transaction_id=request.hold_ledger_transaction_id order by a.ordinal loop
  select t.* into transition from app_private.funding_portion_transitions t where t.kind='HOLD' and t.original_id=allocation.id;
  if allocation.user_id is distinct from original.user_id or allocation.policy_code is distinct from 'NEWEST_FIRST'
   or allocation.effective_at is distinct from admission.effective_at or transition.id is null
   or transition.user_id is distinct from original.user_id or transition.revision is distinct from last_revision+1
   or transition.previous_transition_id is distinct from previous_transition.id then
   raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_COMPLETION_REQUIRED'; end if;
  if boundary_id is null then perform app_private.verify_funding_portion_fact(transition);
  else perform app_private.verify_principal_history_portion_fact(transition,boundary_id);end if;
  total_micro:=total_micro+allocation.allocation_micro_krw;
  last_revision:=transition.revision;previous_transition:=transition;
 end loop;
 if total_micro is distinct from original.amount_atomic::numeric*1000000 then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_PORTION_COMPLETION_REQUIRED'; end if;
 -- This authority-only version cannot authorize an engine advancement before
 -- finance. A later adapter must add its own earned/condition/capacity proof.
 if exists(select 1 from app_private.funding_engine_state_receipts s where s.user_id=original.user_id
   and s.revision>state.revision and s.cursor_at<=admission.effective_at
   and not exists(select 1 from app_private.funding_principal_boundary_preparations b
    join app_private.funding_principal_boundary_completions c on c.boundary_id=b.id
    join app_private.funding_earned_receipts e on e.cause_principal_boundary_id=b.id
    where b.intent_id=original.id and b.clock_admission_id=admission.id and b.phase='HOLD'
     and b.previous_state_id=state.id and b.settlement_expected and b.user_id=original.user_id
     and c.accepted_state_id=s.id and s.previous_state_id=state.id and s.revision=state.revision+1
     and e.id=s.earned_receipt_id and e.next_state_id=s.id and s.cursor_at=admission.effective_at
     and ((c.runtime_outcome='ACCEPTED' and c.condition_id=s.condition_id)
      or(c.runtime_outcome='UNRESOLVED' and c.condition_id is null and s.condition_id=state.condition_id)))) then
  raise exception using errcode='55000',message='PRINCIPAL_RECOVERY_INTENT_STATE_ADVANCED'; end if;
end;
$$;

create or replace function app_private.read_neutral_funding_job_inputs(p_activation uuid,p_state uuid,p_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare activation app_private.funding_engine_activations%rowtype; state app_private.funding_engine_state_receipts%rowtype;
 condition app_private.funding_condition_originals%rowtype; cycle app_private.funding_cycle_windows%rowtype;
 portion record; inputs jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 select * into activation from app_private.funding_engine_activations where id=p_activation;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||activation.user_id::text,0));
 select * into state from app_private.funding_engine_state where user_id=activation.user_id;
 select * into condition from app_private.funding_condition_originals where id=state.condition_id;
 select * into cycle from app_private.funding_cycle_windows where id=state.cycle_id;
 if p_at is null or not isfinite(p_at) or activation.runtime_version is distinct from 2 or state.id is distinct from p_state
  or state.activation_id is distinct from activation.id or state.cycle_closed
  or condition.activation_id is distinct from activation.id or condition.user_id is distinct from activation.user_id
  or cycle.id is distinct from activation.first_cycle_id or p_at<state.cursor_at or p_at>cycle.cycle_end then
  raise exception using errcode='55000',message='FUNDING_JOB_STATE_STALE'; end if;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',activation.user_id,condition.input_digest,
  condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
 if condition.inputs->>'input_contract_version'='3' then
  -- No held-at-cycle-end qualification rule or rollover is inferred.
  if p_at>=cycle.cycle_end then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CYCLE_END_QUALIFICATION_UNAPPROVED';end if;
  if exists(select 1 from app_private.funding_principal_boundary_completions c
   join app_private.funding_principal_boundary_preparations b on b.id=c.boundary_id
   where c.user_id=activation.user_id and c.runtime_outcome='UNRESOLVED' and b.effective_at>=state.cursor_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT_UNRESOLVED';end if;
  perform app_private.assert_input3_condition_snapshot(condition.id);
  inputs:=app_private.read_verified_input3_funding_inputs(activation.user_id,condition.current_allocation_original_id,p_at);
  if inputs is distinct from condition.inputs or condition.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_condition_snapshot(condition)) then
   raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED';end if;
  return inputs;
 end if;
 if condition.inputs->>'input_contract_version'='2' then
  return app_private.read_forward_neutral_job_inputs(p_activation,p_state,p_at); end if;
 if condition.allocation_original_id is not null then
  perform app_private.assert_allocation_boundary_complete(condition.allocation_original_id,condition.id);
 end if;
 inputs:=app_private.read_prospective_funding_inputs(activation.trigger_credit_movement_id,condition.allocation_original_id,p_at);
 if inputs is distinct from condition.inputs then
  raise exception using errcode='55000',message='FUNDING_ACCEPTED_INPUT_CHANGED'; end if;
 select c.*,p.lot_id,p.parent_portion_id,p.amount_micro_krw into portion
 from app_private.funding_portion_clock_state c join app_private.funding_principal_portions p on p.id=c.portion_id
 where c.user_id=activation.user_id;
 if(select count(*) from app_private.funding_portion_clock_state where user_id=activation.user_id)<>1
  or portion.status is distinct from 'AVAILABLE' or portion.parent_portion_id is not null
  or portion.accumulated_eligible_microseconds is distinct from 0::bigint
  or portion.resumed_at is distinct from activation.effective_at
  or portion.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(activation.principal_atomic)
  or portion.lot_id is distinct from(select id from public.funding_principal_lots where money_source_movement_id=activation.trigger_credit_movement_id) then
  raise exception using errcode='55000',message='FUNDING_NEVER_HELD_PORTION_ORIGINAL_REQUIRED'; end if;
 if p_at=cycle.cycle_end and app_private.funding_portion_eligible_age(portion.accumulated_eligible_microseconds,
  portion.resumed_at,p_at,true) is distinct from(extract(epoch from cycle.cycle_end-cycle.cycle_started_at)*1000000)::bigint then
  raise exception using errcode='55000',message='FUNDING_RETENTION_QUALIFICATION_MISSING'; end if;
 return inputs;
end;
$$;

commit;
