begin;

--139 OUTSIDE source candidate: immutable native FINALIZE originals only.
create or replace function app_private.read_principal_portion_funding_inputs(p_user uuid,p_allocation uuid,p_at timestamptz)
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
 available_micro numeric:=0; held_micro numeric:=0; recovered_micro numeric:=0; gross_micro numeric:=0;
 expected_available numeric; expected_held numeric;
 verified_intents uuid[]:=array[]::uuid[];
begin
 perform app_private.assert_principal_input_executor(p_user);
 if p_at is null or not isfinite(p_at) or p_at>clock_timestamp() then
  raise exception using errcode='22023',message='FUNDING_PRINCIPAL_INPUT_TIME_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 if(select coverage from public.money_source_summaries s where s.user_id=p_user) is distinct from 'COMPLETE'
  or exists(select 1 from app_private.funding_cycle_segments s where s.user_id=p_user)
  or exists(select 1 from public.money_source_movements m where m.user_id=p_user and
   ((m.source_bucket='PRINCIPAL' and(m.movement_kind<>'CREDIT' or m.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT')))
    ))
  or exists(select 1 from app_private.funding_portion_transitions t where t.user_id=p_user and t.effective_at>p_at) then
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
  and m.origin_code in('PRINCIPAL_RECOVERY_HOLD','PRINCIPAL_RECOVERY_RELEASE','PRINCIPAL_RECOVERY_FINALIZE') order by m.effective_at,m.id loop
  select m.* into movement from public.money_source_movements m where m.id=source.movement_id;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a
   join public.withdrawal_requests r on r.id=a.withdrawal_id
   where a.user_id=p_user and a.phase=(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' when movement.origin_code='PRINCIPAL_RECOVERY_RELEASE' then 'RELEASE' else 'FINALIZE' end)
    and movement.ledger_transaction_id=(case when a.phase='HOLD' then r.hold_ledger_transaction_id when a.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end);
  select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
  if admission.id is null or intent.user_id is distinct from p_user or movement.effective_at is distinct from admission.effective_at
   or movement.effective_at>p_at or movement.amount_atomic is distinct from admission.amount_atomic then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RECOVERY_ORIGINAL_REQUIRED'; end if;
  -- Each closed intent is checked once during this one immutable-source read.
  -- Every individual movement still verifies its own native clock and journal.
  if not(intent.id=any(verified_intents)) then
   perform app_private.assert_principal_recovery_intent_completion(intent.id);
   verified_intents:=array_append(verified_intents,intent.id);
  end if;
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
  perform app_private.verify_funding_portion_fact(transition);
  previous_transition:=transition;
 end loop;
 for clock in select c.* from app_private.funding_portion_clock_receipts c where c.user_id=p_user loop
  perform app_private.assert_principal_portion_clock_original(clock.id);
 end loop;
 for source in select p.*,c.id as clock_id,c.status,c.effective_at as clock_at,c.accumulated_eligible_microseconds,
   c.resumed_at,c.hold_allocation_id,c.transition_id,c.revision as clock_revision
  from app_private.funding_principal_portions p join app_private.funding_portion_clock_state c on c.portion_id=p.id
  where p.user_id=p_user order by p.id loop
  if source.status='AVAILABLE' then available_micro:=available_micro+source.amount_micro_krw;
  elsif source.status='HELD' then held_micro:=held_micro+source.amount_micro_krw;
  elsif source.status='RECOVERED' then recovered_micro:=recovered_micro+source.amount_micro_krw;
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
 expected_held:=gross_micro-expected_available-recovered_micro;
 if recovered_micro is distinct from(select coalesce(sum(m.amount_atomic::numeric*1000000),0)
  from public.money_source_movements m where m.user_id=p_user and m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and m.effective_at<=p_at) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_FINALIZE_CONSERVATION_REQUIRED';end if;
 if available_micro is distinct from expected_available or held_micro is distinct from expected_held
  or available_micro+held_micro+recovered_micro is distinct from gross_micro or mod(available_micro,1000000)<>0
  or available_micro>9223372036854775807
  or jsonb_array_length(portion_manifest)<>(select count(*) from app_private.funding_principal_portions p where p.user_id=p_user)
  or available_micro/1000000 is distinct from(select s.eligible_principal_atomic::numeric from public.money_source_summaries s where s.user_id=p_user)
  or held_micro/1000000 is distinct from(select s.held_principal_atomic::numeric from public.money_source_summaries s where s.user_id=p_user)
  or recovered_micro/1000000 is distinct from(select s.recovered_principal_atomic::numeric from public.money_source_summaries s where s.user_id=p_user) then
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
 return jsonb_build_object('input_contract_version',3,'user_id',p_user,'credit_originals',manifest,
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
  'slots',coalesce((tier->>'slots')::integer,0),'tier_activated',tier is not null)
  ||(case when recovered_micro>0 then jsonb_build_object('recovered_principal_atomic',div(recovered_micro,1000000)::bigint::text) else '{}'::jsonb end);
end;
$$;


create or replace function app_private.read_verified_input3_funding_inputs(p_user uuid,p_allocation uuid,p_at timestamptz)
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
 available_micro numeric:=0; held_micro numeric:=0; recovered_micro numeric:=0; gross_micro numeric:=0;
 expected_available numeric; expected_held numeric;
 verified_intents uuid[]:=array[]::uuid[];
begin
 perform app_private.assert_verified_input3_current_executor(p_user);
 if p_at is null or not isfinite(p_at) or p_at>clock_timestamp() then
  raise exception using errcode='22023',message='FUNDING_PRINCIPAL_INPUT_TIME_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 if(select coverage from public.money_source_summaries s where s.user_id=p_user) is distinct from 'COMPLETE'
  or exists(select 1 from app_private.funding_cycle_segments s where s.user_id=p_user)
  or exists(select 1 from public.money_source_movements m where m.user_id=p_user and
   ((m.source_bucket='PRINCIPAL' and(m.movement_kind<>'CREDIT' or m.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT')))
    ))
  or exists(select 1 from app_private.funding_portion_transitions t where t.user_id=p_user and t.effective_at>p_at) then
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
  and m.origin_code in('PRINCIPAL_RECOVERY_HOLD','PRINCIPAL_RECOVERY_RELEASE','PRINCIPAL_RECOVERY_FINALIZE') order by m.effective_at,m.id loop
  select m.* into movement from public.money_source_movements m where m.id=source.movement_id;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a
   join public.withdrawal_requests r on r.id=a.withdrawal_id
   where a.user_id=p_user and a.phase=(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' when movement.origin_code='PRINCIPAL_RECOVERY_RELEASE' then 'RELEASE' else 'FINALIZE' end)
    and movement.ledger_transaction_id=(case when a.phase='HOLD' then r.hold_ledger_transaction_id when a.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end);
  select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
  if admission.id is null or intent.user_id is distinct from p_user or movement.effective_at is distinct from admission.effective_at
   or movement.effective_at>p_at or movement.amount_atomic is distinct from admission.amount_atomic then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RECOVERY_ORIGINAL_REQUIRED'; end if;
  -- Each closed intent is checked once during this one immutable-source read.
  -- Every individual movement still verifies its own native clock and journal.
  if not(intent.id=any(verified_intents)) then
   perform app_private.assert_principal_recovery_intent_completion(intent.id);
   verified_intents:=array_append(verified_intents,intent.id);
  end if;
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
  perform app_private.verify_funding_portion_fact(transition);
  previous_transition:=transition;
 end loop;
 for clock in select c.* from app_private.funding_portion_clock_receipts c where c.user_id=p_user loop
  perform app_private.assert_verified_input3_clock_original(clock.id);
 end loop;
 for source in select p.*,c.id as clock_id,c.status,c.effective_at as clock_at,c.accumulated_eligible_microseconds,
   c.resumed_at,c.hold_allocation_id,c.transition_id,c.revision as clock_revision
  from app_private.funding_principal_portions p join app_private.funding_portion_clock_state c on c.portion_id=p.id
  where p.user_id=p_user order by p.id loop
  if source.status='AVAILABLE' then available_micro:=available_micro+source.amount_micro_krw;
  elsif source.status='HELD' then held_micro:=held_micro+source.amount_micro_krw;
  elsif source.status='RECOVERED' then recovered_micro:=recovered_micro+source.amount_micro_krw;
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
 expected_held:=gross_micro-expected_available-recovered_micro;
 if recovered_micro is distinct from(select coalesce(sum(m.amount_atomic::numeric*1000000),0)
  from public.money_source_movements m where m.user_id=p_user and m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and m.effective_at<=p_at) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_FINALIZE_CONSERVATION_REQUIRED';end if;
 if available_micro is distinct from expected_available or held_micro is distinct from expected_held
  or available_micro+held_micro+recovered_micro is distinct from gross_micro or mod(available_micro,1000000)<>0
  or available_micro>9223372036854775807
  or jsonb_array_length(portion_manifest)<>(select count(*) from app_private.funding_principal_portions p where p.user_id=p_user)
  or available_micro/1000000 is distinct from(select s.eligible_principal_atomic::numeric from public.money_source_summaries s where s.user_id=p_user)
  or held_micro/1000000 is distinct from(select s.held_principal_atomic::numeric from public.money_source_summaries s where s.user_id=p_user)
  or recovered_micro/1000000 is distinct from(select s.recovered_principal_atomic::numeric from public.money_source_summaries s where s.user_id=p_user) then
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
 return jsonb_build_object('input_contract_version',3,'user_id',p_user,'credit_originals',manifest,
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
  'slots',coalesce((tier->>'slots')::integer,0),'tier_activated',tier is not null)
  ||(case when recovered_micro>0 then jsonb_build_object('recovered_principal_atomic',div(recovered_micro,1000000)::bigint::text) else '{}'::jsonb end);
end;
$$;


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
 available_micro numeric:=0; held_micro numeric:=0; recovered_micro numeric:=0; gross_micro numeric:=0;
 expected_available numeric; expected_held numeric;
 verified_intents uuid[]:=array[]::uuid[];
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
    ))
  or exists(select 1 from app_private.funding_portion_transitions t where t.user_id=p_user and t.effective_at>p_at) then
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
  and m.origin_code in('PRINCIPAL_RECOVERY_HOLD','PRINCIPAL_RECOVERY_RELEASE','PRINCIPAL_RECOVERY_FINALIZE') order by m.effective_at,m.id loop
  select m.* into movement from public.money_source_movements m where m.id=source.movement_id;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a
   join public.withdrawal_requests r on r.id=a.withdrawal_id
   where a.user_id=p_user and a.phase=(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' when movement.origin_code='PRINCIPAL_RECOVERY_RELEASE' then 'RELEASE' else 'FINALIZE' end)
    and movement.ledger_transaction_id=(case when a.phase='HOLD' then r.hold_ledger_transaction_id when a.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end);
  select i.* into intent from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=admission.withdrawal_id;
  if admission.id is null or intent.user_id is distinct from p_user or movement.effective_at is distinct from admission.effective_at
   or movement.effective_at>p_at or movement.amount_atomic is distinct from admission.amount_atomic then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_RECOVERY_ORIGINAL_REQUIRED'; end if;
  -- Each closed intent is checked once during this one immutable-source read.
  -- Every individual movement still verifies its own native clock and journal.
  if not(intent.id=any(verified_intents)) then
   perform app_private.assert_principal_recovery_intent_completion(intent.id);
   verified_intents:=array_append(verified_intents,intent.id);
  end if;
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
  elsif source.status='RECOVERED' then recovered_micro:=recovered_micro+source.amount_micro_krw;
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
 expected_held:=gross_micro-expected_available-recovered_micro;
 if recovered_micro is distinct from(select coalesce(sum(m.amount_atomic::numeric*1000000),0)
  from public.money_source_movements m where m.user_id=p_user and m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and m.effective_at<=p_at) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_FINALIZE_CONSERVATION_REQUIRED';end if;
 if available_micro is distinct from expected_available or held_micro is distinct from expected_held
  or available_micro+held_micro+recovered_micro is distinct from gross_micro or mod(available_micro,1000000)<>0
  or available_micro>9223372036854775807
  or jsonb_array_length(portion_manifest)<>(select count(*) from app_private.funding_principal_portions p where p.user_id=p_user)
  or available_micro/1000000 is distinct from(current_condition.inputs->>'principal_atomic')::numeric
  or held_micro/1000000 is distinct from(current_condition.inputs->>'held_principal_atomic')::numeric
  or recovered_micro/1000000 is distinct from coalesce((current_condition.inputs->>'recovered_principal_atomic')::numeric,0) then
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
 if recovered_micro>0 then result:=result||jsonb_build_object('recovered_principal_atomic',div(recovered_micro,1000000)::bigint::text);end if;
 -- Fresh policy/allocation and every current source/portion/clock are computed
 -- independently above, then matched to the previous completed condition.
 -- No new observation time, age or credit/hold fact is appended to that input.
 if result is distinct from current_condition.inputs then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_INPUT3_CURRENT_INPUTS_CHANGED';end if;
 return result;
end;
$$;


commit;
