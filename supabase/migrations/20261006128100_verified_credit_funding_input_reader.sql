begin;

-- Actual current neutral credit manifest reader. Still disconnected: no credit
-- hook, activation, state acceptance, time override or monetary write is enabled.
-- Previous immutable sources are verified exactly; unsupported held/history or
-- control cutovers remain explicit until their independently reviewed adapters.
create function app_private.read_verified_credit_funding_inputs(p_user uuid,p_allocation uuid,p_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare movement public.money_source_movements%rowtype; principal public.funding_principal_revisions%rowtype;
 policy app_private.economy_policy_published%rowtype; receipt app_private.economy_policy_receipts%rowtype;
 policy_revision integer:=0; previous uuid; tier jsonb; allocation_bps integer:=0;
 cumulative_micro numeric:=0; first_credit_at timestamptz; manifest jsonb:='[]'::jsonb;
 source record; source_count bigint; credits bigint; role_name text;
begin
 role_name:=current_setting('role',true);
 if p_user is null or (
   (role_name='service_role' and auth.role()='service_role')
   or(role_name='authenticated' and auth.role()='authenticated' and auth.uid()=p_user)) is not true then
  raise exception using errcode='42501',message='FUNDING_INPUT_SUBJECT_FORBIDDEN'; end if;
 if p_at is null or not isfinite(p_at) or p_at>clock_timestamp()
   or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||p_user::text,0));
 if(select coverage from public.money_source_summaries where user_id=p_user) is distinct from 'COMPLETE'
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
 if exists(select 1 from public.safe_mode_controls where component in('GLOBAL','NEW_MINING','SETTLEMENT')
   and(is_paused or starts_at>=first_credit_at))
  or exists(select 1 from public.audit_logs where target_type='SAFE_MODE' and target_id in('GLOBAL','NEW_MINING','SETTLEMENT')
   and(after_state->>'starts_at')::timestamptz>=first_credit_at)
  or exists(select 1 from public.block_rules where user_id=p_user and scope='ACCOUNT'
   and(ends_at is null or ends_at>first_credit_at)) then
  raise exception using errcode='55000',message='FUNDING_CONTROL_BOUNDARY_ADAPTER_REQUIRED'; end if;
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

alter function app_private.read_verified_credit_funding_inputs(uuid,uuid,timestamptz) owner to postgres;
revoke all on function app_private.read_verified_credit_funding_inputs(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.read_verified_credit_funding_inputs(uuid,uuid,timestamptz) to service_role;

commit;
