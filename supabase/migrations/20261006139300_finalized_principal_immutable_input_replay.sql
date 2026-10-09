begin;

-- Private owner-only snapshot bound reuse. No writable cache or external proof input.
create function app_private.assert_principal_history_transition_bounded(p_transition app_private.funding_portion_transitions,p_boundary uuid,p_verified_last_revision bigint)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 movement public.money_source_movements%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 if current_user is distinct from 'postgres' or p_verified_last_revision is null
  or p_verified_last_revision<1 then
  raise exception using errcode='42501',message='FUNDING_PRIVATE_VERIFIED_BOUND_REQUIRED';end if;
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
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a
   where a.withdrawal_id=request.id and a.user_id=p_transition.user_id and a.phase='FINALIZE';
  if admission.id is null or admission.effective_at is distinct from p_transition.effective_at then
   raise exception using errcode='55000',message='FUNDING_PORTION_FINALIZE_ADMISSION_REQUIRED';end if;
  perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
 else raise exception using errcode='55000',message='FUNDING_PORTION_TRANSITION_KIND_INVALID';
 end if;
 if p_transition.user_id is distinct from(select c.user_id from app_private.funding_principal_boundary_completions c where c.boundary_id=p_boundary and c.runtime_outcome='ACCEPTED')
  or p_transition.revision>p_verified_last_revision
  or not exists(select 1 from app_private.funding_portion_transitions t where t.id=p_transition.id and to_jsonb(t)=to_jsonb(p_transition)) then
  raise exception using errcode='55000',message='FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED'; end if;
end;
$$;

create function app_private.assert_input3_history_transition_bounded(p_transition app_private.funding_portion_transitions,p_condition uuid,p_verified_last_revision bigint)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 movement public.money_source_movements%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 if current_user is distinct from 'postgres' or p_verified_last_revision is null
  or p_verified_last_revision<1 then
  raise exception using errcode='42501',message='FUNDING_PRIVATE_VERIFIED_BOUND_REQUIRED';end if;
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
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a
   where a.withdrawal_id=request.id and a.user_id=p_transition.user_id and a.phase='FINALIZE';
  if admission.id is null or admission.effective_at is distinct from p_transition.effective_at then
   raise exception using errcode='55000',message='FUNDING_PORTION_FINALIZE_ADMISSION_REQUIRED';end if;
  perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
 else raise exception using errcode='55000',message='FUNDING_PORTION_TRANSITION_KIND_INVALID';
 end if;
 if p_transition.user_id is distinct from(select c.user_id from app_private.funding_condition_originals c where c.id=p_condition)
  or p_transition.revision>p_verified_last_revision
  or not exists(select 1 from app_private.funding_portion_transitions t where t.id=p_transition.id and to_jsonb(t)=to_jsonb(p_transition)) then
  raise exception using errcode='55000',message='FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED'; end if;
end;
$$;

create function app_private.verify_principal_history_portion_fact_bounded(p_transition app_private.funding_portion_transitions,p_boundary uuid,p_verified_last_revision bigint) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 candidate record; expected jsonb:='[]'::jsonb; actual jsonb; left_micro bigint; take_micro bigint; amount_micro bigint;
begin
 if current_user is distinct from 'postgres' or p_verified_last_revision is null
  or p_verified_last_revision<1 then
  raise exception using errcode='42501',message='FUNDING_PRIVATE_VERIFIED_BOUND_REQUIRED';end if;
 perform app_private.assert_principal_history_transition_bounded(p_transition,p_boundary,p_verified_last_revision);
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

create function app_private.verify_input3_history_portion_fact_bounded(p_transition app_private.funding_portion_transitions,p_condition uuid,p_verified_last_revision bigint) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 candidate record; expected jsonb:='[]'::jsonb; actual jsonb; left_micro bigint; take_micro bigint; amount_micro bigint;
begin
 if current_user is distinct from 'postgres' or p_verified_last_revision is null
  or p_verified_last_revision<1 then
  raise exception using errcode='42501',message='FUNDING_PRIVATE_VERIFIED_BOUND_REQUIRED';end if;
 perform app_private.assert_input3_history_transition_bounded(p_transition,p_condition,p_verified_last_revision);
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

create function app_private.assert_principal_history_clock_original_bounded(p_clock uuid,p_boundary uuid,p_verified_last_revision bigint) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare clock app_private.funding_portion_clock_receipts%rowtype;
 portion app_private.funding_principal_portions%rowtype;
 predecessor app_private.funding_portion_clock_receipts%rowtype;
 parent_clock app_private.funding_portion_clock_receipts%rowtype;
 transition app_private.funding_portion_transitions%rowtype;
 allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype;
 lot public.funding_principal_lots%rowtype; age bigint;
 request public.withdrawal_requests%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 if current_user is distinct from 'postgres' or p_verified_last_revision is null
  or p_verified_last_revision<1 then
  raise exception using errcode='42501',message='FUNDING_PRIVATE_VERIFIED_BOUND_REQUIRED';end if;
 select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=p_clock;
 select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
 select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
 perform app_private.assert_principal_history_executor(clock.user_id);
 if clock.id is null or portion.user_id is distinct from clock.user_id
  or transition.user_id is distinct from clock.user_id
  or clock.effective_at is distinct from transition.effective_at
  or(clock.status='AVAILABLE' and clock.resumed_at is distinct from clock.effective_at)
  or(clock.status<>'AVAILABLE' and clock.resumed_at is not null) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_principal_history_transition_bounded(transition,p_boundary,p_verified_last_revision);
 if clock.revision=0 then
  if clock.previous_clock_id is not null or clock.transition_id is distinct from portion.introduced_by_transition_id then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
  if portion.parent_portion_id is null then
   select l.* into lot from public.funding_principal_lots l where l.id=portion.lot_id;
   if transition.kind is distinct from 'CREDIT' or transition.original_id is distinct from lot.id
    or portion.user_id is distinct from lot.user_id or portion.amount_micro_krw is distinct from lot.amount_micro_krw
    or clock.status is distinct from 'AVAILABLE' or clock.accumulated_eligible_microseconds<>0
    or clock.hold_allocation_id is not null then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
  else
   select c.* into parent_clock from app_private.funding_portion_clock_receipts c
    where c.portion_id=portion.parent_portion_id and c.transition_id=transition.id;
   if transition.kind is distinct from 'HOLD' or parent_clock.status is distinct from 'SPLIT' or parent_clock.user_id is distinct from clock.user_id
    or not exists(select 1 from app_private.funding_principal_portions p where p.id=portion.parent_portion_id
     and p.lot_id=portion.lot_id and p.user_id=portion.user_id and p.amount_micro_krw>portion.amount_micro_krw)
    or clock.status not in('AVAILABLE','HELD')
    or clock.accumulated_eligible_microseconds is distinct from parent_clock.accumulated_eligible_microseconds
    or(clock.status='AVAILABLE' and clock.hold_allocation_id is not null)
    or(clock.status='HELD' and clock.hold_allocation_id is distinct from transition.original_id) then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_SPLIT_MISMATCH'; end if;
  end if;
 else
  select c.* into predecessor from app_private.funding_portion_clock_receipts c where c.id=clock.previous_clock_id;
  if predecessor.user_id is distinct from clock.user_id or predecessor.portion_id is distinct from clock.portion_id
   or clock.revision is distinct from predecessor.revision+1 or clock.effective_at<predecessor.effective_at
   or predecessor.status not in('AVAILABLE','HELD') then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_PREDECESSOR_MISMATCH'; end if;
  age:=app_private.funding_portion_eligible_age(predecessor.accumulated_eligible_microseconds,
   predecessor.resumed_at,clock.effective_at,predecessor.status='AVAILABLE');
  if clock.accumulated_eligible_microseconds is distinct from age then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_AGE_MISMATCH'; end if;
  if transition.kind='HOLD' then
   select a.* into allocation from public.funding_principal_recovery_allocations a where a.id=transition.original_id;
   if predecessor.status is distinct from 'AVAILABLE' or clock.status not in('HELD','SPLIT')
    or allocation.user_id is distinct from clock.user_id or allocation.lot_id is distinct from portion.lot_id
    or clock.hold_allocation_id is distinct from allocation.id then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_HOLD_MISMATCH'; end if;
  elsif transition.kind='RELEASE' then
   select r.* into release from public.funding_principal_recovery_releases r where r.id=transition.original_id;
   select a.* into allocation from public.funding_principal_recovery_allocations a where a.id=predecessor.hold_allocation_id;
   if predecessor.status is distinct from 'HELD' or clock.status is distinct from 'AVAILABLE'
    or allocation.hold_ledger_transaction_id is distinct from release.hold_ledger_transaction_id
    or release.user_id is distinct from clock.user_id or clock.hold_allocation_id is not null then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_RELEASE_MISMATCH'; end if;
  elsif transition.kind='FINALIZE' then
   select r.* into request from public.withdrawal_requests r where r.id=transition.original_id;
   select a.* into allocation from public.funding_principal_recovery_allocations a where a.id=predecessor.hold_allocation_id;
   select a.* into admission from app_private.funding_withdrawal_clock_admissions a
    where a.withdrawal_id=request.id and a.user_id=clock.user_id and a.phase='FINALIZE';
   if predecessor.status is distinct from 'HELD' or clock.status is distinct from 'RECOVERED'
    or allocation.user_id is distinct from clock.user_id or allocation.lot_id is distinct from portion.lot_id
    or allocation.hold_ledger_transaction_id is distinct from request.hold_ledger_transaction_id
    or clock.hold_allocation_id is distinct from predecessor.hold_allocation_id
    or admission.id is null or admission.effective_at is distinct from clock.effective_at
    or request.user_id is distinct from clock.user_id or request.status is distinct from 'COMPLETED'
    or request.release_ledger_transaction_id is not null then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_FINALIZE_MISMATCH';end if;
   perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
  else
   -- Cycle-end maintenance qualification remains a separate unsupported rule.
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_CAUSE_UNSUPPORTED';
  end if;
 end if;
end;
$$;

create function app_private.assert_input3_history_clock_original_bounded(p_clock uuid,p_condition uuid,p_verified_last_revision bigint) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare clock app_private.funding_portion_clock_receipts%rowtype;
 portion app_private.funding_principal_portions%rowtype;
 predecessor app_private.funding_portion_clock_receipts%rowtype;
 parent_clock app_private.funding_portion_clock_receipts%rowtype;
 transition app_private.funding_portion_transitions%rowtype;
 allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype;
 lot public.funding_principal_lots%rowtype; age bigint;
 request public.withdrawal_requests%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 if current_user is distinct from 'postgres' or p_verified_last_revision is null
  or p_verified_last_revision<1 then
  raise exception using errcode='42501',message='FUNDING_PRIVATE_VERIFIED_BOUND_REQUIRED';end if;
 select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=p_clock;
 select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
 select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
 perform app_private.assert_verified_input3_history_executor(clock.user_id);
 if clock.id is null or portion.user_id is distinct from clock.user_id
  or transition.user_id is distinct from clock.user_id
  or clock.effective_at is distinct from transition.effective_at
  or(clock.status='AVAILABLE' and clock.resumed_at is distinct from clock.effective_at)
  or(clock.status<>'AVAILABLE' and clock.resumed_at is not null) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_input3_history_transition_bounded(transition,p_condition,p_verified_last_revision);
 if clock.revision=0 then
  if clock.previous_clock_id is not null or clock.transition_id is distinct from portion.introduced_by_transition_id then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
  if portion.parent_portion_id is null then
   select l.* into lot from public.funding_principal_lots l where l.id=portion.lot_id;
   if transition.kind is distinct from 'CREDIT' or transition.original_id is distinct from lot.id
    or portion.user_id is distinct from lot.user_id or portion.amount_micro_krw is distinct from lot.amount_micro_krw
    or clock.status is distinct from 'AVAILABLE' or clock.accumulated_eligible_microseconds<>0
    or clock.hold_allocation_id is not null then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
  else
   select c.* into parent_clock from app_private.funding_portion_clock_receipts c
    where c.portion_id=portion.parent_portion_id and c.transition_id=transition.id;
   if transition.kind is distinct from 'HOLD' or parent_clock.status is distinct from 'SPLIT' or parent_clock.user_id is distinct from clock.user_id
    or not exists(select 1 from app_private.funding_principal_portions p where p.id=portion.parent_portion_id
     and p.lot_id=portion.lot_id and p.user_id=portion.user_id and p.amount_micro_krw>portion.amount_micro_krw)
    or clock.status not in('AVAILABLE','HELD')
    or clock.accumulated_eligible_microseconds is distinct from parent_clock.accumulated_eligible_microseconds
    or(clock.status='AVAILABLE' and clock.hold_allocation_id is not null)
    or(clock.status='HELD' and clock.hold_allocation_id is distinct from transition.original_id) then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_SPLIT_MISMATCH'; end if;
  end if;
 else
  select c.* into predecessor from app_private.funding_portion_clock_receipts c where c.id=clock.previous_clock_id;
  if predecessor.user_id is distinct from clock.user_id or predecessor.portion_id is distinct from clock.portion_id
   or clock.revision is distinct from predecessor.revision+1 or clock.effective_at<predecessor.effective_at
   or predecessor.status not in('AVAILABLE','HELD') then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_PREDECESSOR_MISMATCH'; end if;
  age:=app_private.funding_portion_eligible_age(predecessor.accumulated_eligible_microseconds,
   predecessor.resumed_at,clock.effective_at,predecessor.status='AVAILABLE');
  if clock.accumulated_eligible_microseconds is distinct from age then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_AGE_MISMATCH'; end if;
  if transition.kind='HOLD' then
   select a.* into allocation from public.funding_principal_recovery_allocations a where a.id=transition.original_id;
   if predecessor.status is distinct from 'AVAILABLE' or clock.status not in('HELD','SPLIT')
    or allocation.user_id is distinct from clock.user_id or allocation.lot_id is distinct from portion.lot_id
    or clock.hold_allocation_id is distinct from allocation.id then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_HOLD_MISMATCH'; end if;
  elsif transition.kind='RELEASE' then
   select r.* into release from public.funding_principal_recovery_releases r where r.id=transition.original_id;
   select a.* into allocation from public.funding_principal_recovery_allocations a where a.id=predecessor.hold_allocation_id;
   if predecessor.status is distinct from 'HELD' or clock.status is distinct from 'AVAILABLE'
    or allocation.hold_ledger_transaction_id is distinct from release.hold_ledger_transaction_id
    or release.user_id is distinct from clock.user_id or clock.hold_allocation_id is not null then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_RELEASE_MISMATCH'; end if;
  elsif transition.kind='FINALIZE' then
   select r.* into request from public.withdrawal_requests r where r.id=transition.original_id;
   select a.* into allocation from public.funding_principal_recovery_allocations a where a.id=predecessor.hold_allocation_id;
   select a.* into admission from app_private.funding_withdrawal_clock_admissions a
    where a.withdrawal_id=request.id and a.user_id=clock.user_id and a.phase='FINALIZE';
   if predecessor.status is distinct from 'HELD' or clock.status is distinct from 'RECOVERED'
    or allocation.user_id is distinct from clock.user_id or allocation.lot_id is distinct from portion.lot_id
    or allocation.hold_ledger_transaction_id is distinct from request.hold_ledger_transaction_id
    or clock.hold_allocation_id is distinct from predecessor.hold_allocation_id
    or admission.id is null or admission.effective_at is distinct from clock.effective_at
    or request.user_id is distinct from clock.user_id or request.status is distinct from 'COMPLETED'
    or request.release_ledger_transaction_id is not null then
    raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_FINALIZE_MISMATCH';end if;
   perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
  else
   -- Cycle-end maintenance qualification remains a separate unsupported rule.
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_CAUSE_UNSUPPORTED';
  end if;
 end if;
end;
$$;

revoke all on function
 app_private.assert_principal_history_transition_bounded(app_private.funding_portion_transitions,uuid,bigint),
 app_private.assert_input3_history_transition_bounded(app_private.funding_portion_transitions,uuid,bigint),
 app_private.verify_principal_history_portion_fact_bounded(app_private.funding_portion_transitions,uuid,bigint),
 app_private.verify_input3_history_portion_fact_bounded(app_private.funding_portion_transitions,uuid,bigint),
 app_private.assert_principal_history_clock_original_bounded(uuid,uuid,bigint),
 app_private.assert_input3_history_clock_original_bounded(uuid,uuid,bigint)
 from public,anon,authenticated,service_role;

--139 OUTSIDE source candidate: immutable native FINALIZE originals only.
create or replace function app_private.assert_principal_input_snapshot(p_boundary uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare preparation app_private.funding_principal_boundary_preparations%rowtype;
 completion app_private.funding_principal_boundary_completions%rowtype; inputs jsonb; item jsonb;
 movement public.money_source_movements%rowtype; lot public.funding_principal_lots%rowtype;
 revision public.funding_principal_revisions%rowtype; clock app_private.funding_portion_clock_receipts%rowtype;
 portion app_private.funding_principal_portions%rowtype; transition app_private.funding_portion_transitions%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 last_revision bigint; available numeric:=0; held numeric:=0; recovered numeric:=0; gross numeric:=0; actual_count bigint;
 expected jsonb; policy app_private.economy_policy_published%rowtype; tier jsonb; allocation_bps integer; native_allocation public.funding_principal_recovery_allocations%rowtype;
begin
 select b.* into preparation from app_private.funding_principal_boundary_preparations b where b.id=p_boundary;
 select c.* into completion from app_private.funding_principal_boundary_completions c where c.boundary_id=p_boundary;
 perform app_private.assert_principal_history_executor(preparation.user_id);
 last_revision:=app_private.principal_snapshot_last_transition(p_boundary);inputs:=completion.input_original;
 if inputs->>'user_id' is distinct from preparation.user_id::text
  or inputs->>'principal_original_digest' is distinct from app_private.funding_engine_digest(inputs->'credit_originals')
  or inputs->>'recovery_original_digest' is distinct from app_private.funding_engine_digest(inputs->'recovery_originals')
  or inputs->>'portion_clock_original_digest' is distinct from app_private.funding_engine_digest(inputs->'portion_clock_originals') then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_INPUT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'credit_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'credit_id')::uuid;
  select l.* into lot from public.funding_principal_lots l where l.id=(item->>'lot_id')::uuid;
  select r.* into revision from public.funding_principal_revisions r where r.id=(item->>'principal_revision_id')::uuid;
  if movement.user_id is distinct from preparation.user_id or movement.source_bucket is distinct from 'PRINCIPAL'
   or movement.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT') or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at>preparation.effective_at or lot.user_id is distinct from preparation.user_id
   or lot.money_source_movement_id is distinct from movement.id or revision.money_source_movement_id is distinct from movement.id
   or revision.user_id is distinct from preparation.user_id or revision.lot_id is distinct from lot.id
   or revision.direction is distinct from 'INCREASE' or revision.delta_micro_krw is distinct from lot.amount_micro_krw
   or lot.amount_atomic is distinct from movement.amount_atomic or lot.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
   or lot.ledger_transaction_id is distinct from movement.ledger_transaction_id or lot.source_event_id is distinct from movement.source_event_id
   or lot.effective_at is distinct from movement.effective_at or revision.effective_at is distinct from movement.effective_at
   or revision.ledger_transaction_id is distinct from movement.ledger_transaction_id or revision.source_event_id is distinct from movement.source_event_id
   or revision.hold_ledger_transaction_id is not null
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(preparation.user_id,movement.effective_at)
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or not exists(select 1 from app_private.funding_portion_transitions t where t.user_id=preparation.user_id
    and t.kind='CREDIT' and t.original_id=lot.id and t.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
  perform app_private.assert_money_source_credit(movement);gross:=gross+lot.amount_micro_krw;
 end loop;
 select count(*) into actual_count from public.funding_principal_lots l join app_private.funding_portion_transitions t
  on t.kind='CREDIT' and t.original_id=l.id where l.user_id=preparation.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'credit_originals')
  or actual_count<>(select count(distinct x->>'credit_id') from jsonb_array_elements(inputs->'credit_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'recovery_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'movement_id')::uuid;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=(item->>'clock_admission_id')::uuid;
  if movement.user_id is distinct from preparation.user_id or admission.user_id is distinct from preparation.user_id
   or movement.effective_at>preparation.effective_at or movement.effective_at is distinct from admission.effective_at
   or admission.phase is distinct from(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' when movement.origin_code='PRINCIPAL_RECOVERY_RELEASE' then 'RELEASE' when movement.origin_code='PRINCIPAL_RECOVERY_FINALIZE' then 'FINALIZE' else null end)
   or movement.ledger_transaction_id is distinct from(select(case when admission.phase='HOLD' then r.hold_ledger_transaction_id when admission.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end) from public.withdrawal_requests r where r.id=admission.withdrawal_id)
   or item->>'origin_code' is distinct from movement.origin_code or item->>'ledger_transaction_id' is distinct from movement.ledger_transaction_id::text
   or item->>'source_event_id' is distinct from movement.source_event_id::text or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or item->>'intent_id' is distinct from(select i.id::text from app_private.funding_principal_recovery_intent_originals i
    where i.withdrawal_id=admission.withdrawal_id and i.user_id=preparation.user_id) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
  perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
  perform app_private.assert_principal_recovery_movement(movement);
 end loop;
 select count(distinct m.id) into actual_count from public.money_source_movements m
  join app_private.funding_portion_transitions t on t.user_id=m.user_id and t.revision<=last_revision
  left join public.funding_principal_recovery_allocations a on t.kind='HOLD' and a.id=t.original_id
  left join public.funding_principal_recovery_releases r on t.kind='RELEASE' and r.id=t.original_id
  left join public.withdrawal_requests finalized on t.kind='FINALIZE' and finalized.id=t.original_id
  where m.user_id=preparation.user_id and
   ((m.origin_code='PRINCIPAL_RECOVERY_HOLD' and m.ledger_transaction_id=a.hold_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_RELEASE' and m.ledger_transaction_id=r.release_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and m.ledger_transaction_id=finalized.finalize_ledger_transaction_id));
 if actual_count<>jsonb_array_length(inputs->'recovery_originals')
  or actual_count<>(select count(distinct x->>'movement_id') from jsonb_array_elements(inputs->'recovery_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
 -- Archived DECREASE revisions are independently bound to native HOLD
 -- allocation/source, not inferred from the aggregate JSON or present wallet.
 for native_allocation in select a.* from public.funding_principal_recovery_allocations a
  join app_private.funding_portion_transitions t on t.kind='HOLD' and t.original_id=a.id
  where a.user_id=preparation.user_id and t.revision<=last_revision loop
  select r.* into revision from public.funding_principal_revisions r where r.user_id=preparation.user_id
   and r.hold_ledger_transaction_id=native_allocation.hold_ledger_transaction_id and r.lot_id=native_allocation.lot_id;
  if native_allocation.policy_code is distinct from 'NEWEST_FIRST' or revision.id is null
   or revision.direction is distinct from 'DECREASE' or revision.money_source_movement_id is not null
   or revision.ledger_transaction_id is distinct from native_allocation.hold_ledger_transaction_id
   or revision.delta_micro_krw is distinct from native_allocation.allocation_micro_krw
   or revision.effective_at is distinct from native_allocation.effective_at
   or revision.source_event_id is distinct from(select m.source_event_id from public.money_source_movements m
    where m.user_id=preparation.user_id and m.ledger_transaction_id=native_allocation.hold_ledger_transaction_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD')
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(preparation.user_id,native_allocation.effective_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_REVISION_MISMATCH';end if;
 end loop;
 for transition in select t.* from app_private.funding_portion_transitions t
  where t.user_id=preparation.user_id and t.revision<=last_revision order by t.revision loop
  perform app_private.verify_principal_history_portion_fact_bounded(transition,p_boundary,last_revision);
 end loop;
 for item in select value from jsonb_array_elements(inputs->'portion_clock_originals') loop
  select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=(item->>'clock_id')::uuid;
  select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
  select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
  expected:=jsonb_build_object('portion_id',portion.id,'lot_id',portion.lot_id,'parent_portion_id',portion.parent_portion_id,
   'amount_micro_krw',portion.amount_micro_krw::text,'clock_id',clock.id,'clock_revision',clock.revision::text,
   'transition_id',clock.transition_id,'status',clock.status,
   'clock_at_microseconds',((extract(epoch from clock.effective_at)*1000000)::bigint)::text,
   'accumulated_eligible_microseconds',clock.accumulated_eligible_microseconds::text,
   'resumed_at_microseconds',(case when clock.resumed_at is null then null else((extract(epoch from clock.resumed_at)*1000000)::bigint)::text end),
   'hold_allocation_id',clock.hold_allocation_id);
  if portion.user_id is distinct from preparation.user_id or clock.user_id is distinct from preparation.user_id
   or item is distinct from expected or transition.revision>last_revision
   or exists(select 1 from app_private.funding_portion_clock_receipts next_clock
    join app_private.funding_portion_transitions next_transition on next_transition.id=next_clock.transition_id
    where next_clock.portion_id=portion.id and next_clock.revision>clock.revision and next_transition.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CLOCK_MISMATCH';end if;
  perform app_private.assert_principal_history_clock_original_bounded(clock.id,p_boundary,last_revision);
  if clock.status='AVAILABLE' then available:=available+portion.amount_micro_krw;
  elsif clock.status='HELD' then held:=held+portion.amount_micro_krw;
  elsif clock.status='RECOVERED' then recovered:=recovered+portion.amount_micro_krw;
  elsif clock.status<>'SPLIT' then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_STATUS_UNSUPPORTED';end if;
 end loop;
 select count(*) into actual_count from app_private.funding_principal_portions p
  join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
  where p.user_id=preparation.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'portion_clock_originals')
  or actual_count<>(select count(distinct x->>'portion_id') from jsonb_array_elements(inputs->'portion_clock_originals') x)
  or available+held+recovered is distinct from gross or available/1000000 is distinct from(inputs->>'principal_atomic')::numeric
  or held/1000000 is distinct from(inputs->>'held_principal_atomic')::numeric
  or recovered/1000000 is distinct from coalesce((inputs->>'recovered_principal_atomic')::numeric,0)
  or recovered is distinct from(select coalesce(sum(m.amount_atomic::numeric*1000000),0) from public.money_source_movements m
    join public.withdrawal_requests r on r.finalize_ledger_transaction_id=m.ledger_transaction_id
    join app_private.funding_portion_transitions t on t.kind='FINALIZE' and t.original_id=r.id
    where m.user_id=preparation.user_id and m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and t.revision<=last_revision) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CONSERVATION_REQUIRED';end if;
 select p.* into policy from app_private.economy_policy_published p where p.publication_id=(inputs->>'policy_publication_id')::uuid;
 if policy.config_digest is distinct from inputs->>'policy_config_digest' or policy.effective_from>preparation.effective_at
  or(policy.effective_until is not null and policy.effective_until<=preparation.effective_at)
  or inputs->>'base_bps' is distinct from policy.config->>'baseCycleRateBps'
  or inputs->>'cycle_days' is distinct from policy.config->>'cycleDays' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_POLICY_MISMATCH';end if;
 perform app_private.assert_economy_policy_receipt(policy.revision_id);
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::numeric<=available/1000000
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::numeric>=available/1000000);
 if tier is null or inputs->>'retention_bps' is distinct from tier->>'retentionBonusBps'
  or inputs->>'tier_code' is distinct from tier->>'code' or inputs->>'slots' is distinct from tier->>'slots' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_TIER_MISMATCH';end if;
 if preparation.current_allocation_original_id is null then allocation_bps:=0;
 else allocation_bps:=app_private.assert_prospective_allocation(preparation.current_allocation_original_id,preparation.user_id,policy.config,(tier->>'slots')::integer);end if;
 if inputs->>'allocation_id' is distinct from preparation.current_allocation_original_id::text
  or inputs->>'allocation_bps' is distinct from allocation_bps::text
  or inputs->>'allocation_digest' is distinct from(select a.input_digest from app_private.funding_allocation_originals a
   where a.id=preparation.current_allocation_original_id) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_ALLOCATION_MISMATCH';end if;
end;
$$;


create or replace function app_private.assert_input3_condition_snapshot(p_condition uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare condition app_private.funding_condition_originals%rowtype; inputs jsonb; item jsonb;
 movement public.money_source_movements%rowtype; lot public.funding_principal_lots%rowtype;
 revision public.funding_principal_revisions%rowtype; clock app_private.funding_portion_clock_receipts%rowtype;
 portion app_private.funding_principal_portions%rowtype; transition app_private.funding_portion_transitions%rowtype;
 admission app_private.funding_withdrawal_clock_admissions%rowtype;
 last_revision bigint; available numeric:=0; held numeric:=0; recovered numeric:=0; gross numeric:=0; actual_count bigint;
 expected jsonb; policy app_private.economy_policy_published%rowtype; tier jsonb; allocation_bps integer; native_allocation public.funding_principal_recovery_allocations%rowtype;
begin
 select c.* into condition from app_private.funding_condition_originals c where c.id=p_condition;
 perform app_private.assert_verified_input3_history_executor(condition.user_id);
 perform app_private.input3_condition_accepted_state(condition.id);
 if condition.cause_principal_boundary_id is not null then
  perform app_private.assert_principal_input_snapshot(condition.cause_principal_boundary_id);return;
 end if;
 if(select c.inputs->>'input_contract_version' from app_private.funding_condition_originals c where c.id=condition.previous_condition_id)='3' then
  perform app_private.assert_input3_condition_snapshot(condition.previous_condition_id);
 end if;
 last_revision:=app_private.input3_snapshot_last_transition(p_condition);inputs:=condition.inputs;
 if inputs->>'user_id' is distinct from condition.user_id::text
  or inputs->>'principal_original_digest' is distinct from app_private.funding_engine_digest(inputs->'credit_originals')
  or inputs->>'recovery_original_digest' is distinct from app_private.funding_engine_digest(inputs->'recovery_originals')
  or inputs->>'portion_clock_original_digest' is distinct from app_private.funding_engine_digest(inputs->'portion_clock_originals') then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_INPUT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'credit_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'credit_id')::uuid;
  select l.* into lot from public.funding_principal_lots l where l.id=(item->>'lot_id')::uuid;
  select r.* into revision from public.funding_principal_revisions r where r.id=(item->>'principal_revision_id')::uuid;
  if movement.user_id is distinct from condition.user_id or movement.source_bucket is distinct from 'PRINCIPAL'
   or movement.origin_code not in('KRW_DEPOSIT','USDT_KRW_DEPOSIT') or movement.movement_kind is distinct from 'CREDIT'
   or movement.effective_at>condition.effective_at or lot.user_id is distinct from condition.user_id
   or lot.money_source_movement_id is distinct from movement.id or revision.money_source_movement_id is distinct from movement.id
   or revision.user_id is distinct from condition.user_id or revision.lot_id is distinct from lot.id
   or revision.direction is distinct from 'INCREASE' or revision.delta_micro_krw is distinct from lot.amount_micro_krw
   or lot.amount_atomic is distinct from movement.amount_atomic or lot.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(movement.amount_atomic)
   or lot.ledger_transaction_id is distinct from movement.ledger_transaction_id or lot.source_event_id is distinct from movement.source_event_id
   or lot.effective_at is distinct from movement.effective_at or revision.effective_at is distinct from movement.effective_at
   or revision.ledger_transaction_id is distinct from movement.ledger_transaction_id or revision.source_event_id is distinct from movement.source_event_id
   or revision.hold_ledger_transaction_id is not null
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(condition.user_id,movement.effective_at)
   or movement.effective_at<(select introduced_at from app_private.funding_engine_epochs where version=1)
   or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or not exists(select 1 from app_private.funding_portion_transitions t where t.user_id=condition.user_id
    and t.kind='CREDIT' and t.original_id=lot.id and t.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
  perform app_private.assert_money_source_credit(movement);gross:=gross+lot.amount_micro_krw;
 end loop;
 select count(*) into actual_count from public.funding_principal_lots l join app_private.funding_portion_transitions t
  on t.kind='CREDIT' and t.original_id=l.id where l.user_id=condition.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'credit_originals')
  or actual_count<>(select count(distinct x->>'credit_id') from jsonb_array_elements(inputs->'credit_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CREDIT_MISMATCH';end if;
 for item in select value from jsonb_array_elements(inputs->'recovery_originals') loop
  select m.* into movement from public.money_source_movements m where m.id=(item->>'movement_id')::uuid;
  select a.* into admission from app_private.funding_withdrawal_clock_admissions a where a.id=(item->>'clock_admission_id')::uuid;
  if movement.user_id is distinct from condition.user_id or admission.user_id is distinct from condition.user_id
   or movement.effective_at>condition.effective_at or movement.effective_at is distinct from admission.effective_at
   or admission.phase is distinct from(case when movement.origin_code='PRINCIPAL_RECOVERY_HOLD' then 'HOLD' when movement.origin_code='PRINCIPAL_RECOVERY_RELEASE' then 'RELEASE' when movement.origin_code='PRINCIPAL_RECOVERY_FINALIZE' then 'FINALIZE' else null end)
   or movement.ledger_transaction_id is distinct from(select(case when admission.phase='HOLD' then r.hold_ledger_transaction_id when admission.phase='RELEASE' then r.release_ledger_transaction_id else r.finalize_ledger_transaction_id end) from public.withdrawal_requests r where r.id=admission.withdrawal_id)
   or item->>'origin_code' is distinct from movement.origin_code or item->>'ledger_transaction_id' is distinct from movement.ledger_transaction_id::text
   or item->>'source_event_id' is distinct from movement.source_event_id::text or item->>'amount_atomic' is distinct from movement.amount_atomic::text
   or item->>'effective_at_microseconds' is distinct from((extract(epoch from movement.effective_at)*1000000)::bigint)::text
   or item->>'intent_id' is distinct from(select i.id::text from app_private.funding_principal_recovery_intent_originals i
    where i.withdrawal_id=admission.withdrawal_id and i.user_id=condition.user_id) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
  perform app_private.assert_funding_withdrawal_clock_completion(admission.id);
  perform app_private.assert_principal_recovery_movement(movement);
 end loop;
 select count(distinct m.id) into actual_count from public.money_source_movements m
  join app_private.funding_portion_transitions t on t.user_id=m.user_id and t.revision<=last_revision
  left join public.funding_principal_recovery_allocations a on t.kind='HOLD' and a.id=t.original_id
  left join public.funding_principal_recovery_releases r on t.kind='RELEASE' and r.id=t.original_id
  left join public.withdrawal_requests finalized on t.kind='FINALIZE' and finalized.id=t.original_id
  where m.user_id=condition.user_id and
   ((m.origin_code='PRINCIPAL_RECOVERY_HOLD' and m.ledger_transaction_id=a.hold_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_RELEASE' and m.ledger_transaction_id=r.release_ledger_transaction_id)
    or(m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and m.ledger_transaction_id=finalized.finalize_ledger_transaction_id));
 if actual_count<>jsonb_array_length(inputs->'recovery_originals')
  or actual_count<>(select count(distinct x->>'movement_id') from jsonb_array_elements(inputs->'recovery_originals') x) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_MISMATCH';end if;
 -- Archived DECREASE revisions are independently bound to native HOLD
 -- allocation/source, not inferred from the aggregate JSON or present wallet.
 for native_allocation in select a.* from public.funding_principal_recovery_allocations a
  join app_private.funding_portion_transitions t on t.kind='HOLD' and t.original_id=a.id
  where a.user_id=condition.user_id and t.revision<=last_revision loop
  select r.* into revision from public.funding_principal_revisions r where r.user_id=condition.user_id
   and r.hold_ledger_transaction_id=native_allocation.hold_ledger_transaction_id and r.lot_id=native_allocation.lot_id;
  if native_allocation.policy_code is distinct from 'NEWEST_FIRST' or revision.id is null
   or revision.direction is distinct from 'DECREASE' or revision.money_source_movement_id is not null
   or revision.ledger_transaction_id is distinct from native_allocation.hold_ledger_transaction_id
   or revision.delta_micro_krw is distinct from native_allocation.allocation_micro_krw
   or revision.effective_at is distinct from native_allocation.effective_at
   or revision.source_event_id is distinct from(select m.source_event_id from public.money_source_movements m
    where m.user_id=condition.user_id and m.ledger_transaction_id=native_allocation.hold_ledger_transaction_id and m.origin_code='PRINCIPAL_RECOVERY_HOLD')
   or revision.eligible_principal_micro_krw_after is distinct from app_private.funding_principal_mining_eligible_micro(condition.user_id,native_allocation.effective_at) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_RECOVERY_REVISION_MISMATCH';end if;
 end loop;
 for transition in select t.* from app_private.funding_portion_transitions t
  where t.user_id=condition.user_id and t.revision<=last_revision order by t.revision loop
  perform app_private.verify_input3_history_portion_fact_bounded(transition,p_condition,last_revision);
 end loop;
 for item in select value from jsonb_array_elements(inputs->'portion_clock_originals') loop
  select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=(item->>'clock_id')::uuid;
  select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
  select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
  expected:=jsonb_build_object('portion_id',portion.id,'lot_id',portion.lot_id,'parent_portion_id',portion.parent_portion_id,
   'amount_micro_krw',portion.amount_micro_krw::text,'clock_id',clock.id,'clock_revision',clock.revision::text,
   'transition_id',clock.transition_id,'status',clock.status,
   'clock_at_microseconds',((extract(epoch from clock.effective_at)*1000000)::bigint)::text,
   'accumulated_eligible_microseconds',clock.accumulated_eligible_microseconds::text,
   'resumed_at_microseconds',(case when clock.resumed_at is null then null else((extract(epoch from clock.resumed_at)*1000000)::bigint)::text end),
   'hold_allocation_id',clock.hold_allocation_id);
  if portion.user_id is distinct from condition.user_id or clock.user_id is distinct from condition.user_id
   or item is distinct from expected or transition.revision>last_revision
   or exists(select 1 from app_private.funding_portion_clock_receipts next_clock
    join app_private.funding_portion_transitions next_transition on next_transition.id=next_clock.transition_id
    where next_clock.portion_id=portion.id and next_clock.revision>clock.revision and next_transition.revision<=last_revision) then
   raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CLOCK_MISMATCH';end if;
  perform app_private.assert_input3_history_clock_original_bounded(clock.id,p_condition,last_revision);
  if clock.status='AVAILABLE' then available:=available+portion.amount_micro_krw;
  elsif clock.status='HELD' then held:=held+portion.amount_micro_krw;
  elsif clock.status='RECOVERED' then recovered:=recovered+portion.amount_micro_krw;
  elsif clock.status<>'SPLIT' then raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_STATUS_UNSUPPORTED';end if;
 end loop;
 select count(*) into actual_count from app_private.funding_principal_portions p
  join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
  where p.user_id=condition.user_id and t.revision<=last_revision;
 if actual_count<>jsonb_array_length(inputs->'portion_clock_originals')
  or actual_count<>(select count(distinct x->>'portion_id') from jsonb_array_elements(inputs->'portion_clock_originals') x)
  or available+held+recovered is distinct from gross or available/1000000 is distinct from(inputs->>'principal_atomic')::numeric
  or held/1000000 is distinct from(inputs->>'held_principal_atomic')::numeric
  or recovered/1000000 is distinct from coalesce((inputs->>'recovered_principal_atomic')::numeric,0)
  or recovered is distinct from(select coalesce(sum(m.amount_atomic::numeric*1000000),0) from public.money_source_movements m
    join public.withdrawal_requests r on r.finalize_ledger_transaction_id=m.ledger_transaction_id
    join app_private.funding_portion_transitions t on t.kind='FINALIZE' and t.original_id=r.id
    where m.user_id=condition.user_id and m.origin_code='PRINCIPAL_RECOVERY_FINALIZE' and t.revision<=last_revision) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_CONSERVATION_REQUIRED';end if;
 select p.* into policy from app_private.economy_policy_published p where p.publication_id=(inputs->>'policy_publication_id')::uuid;
 if policy.config_digest is distinct from inputs->>'policy_config_digest' or policy.effective_from>condition.effective_at
  or(policy.effective_until is not null and policy.effective_until<=condition.effective_at)
  or inputs->>'base_bps' is distinct from policy.config->>'baseCycleRateBps'
  or inputs->>'cycle_days' is distinct from policy.config->>'cycleDays' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_POLICY_MISMATCH';end if;
 perform app_private.assert_economy_policy_receipt(policy.revision_id);
 select value into tier from jsonb_array_elements(policy.config->'tiers') where
  (value->>'minimumPrincipalKrw')::numeric<=available/1000000
  and(value->>'maximumPrincipalKrw' is null or(value->>'maximumPrincipalKrw')::numeric>=available/1000000);
 if tier is null or inputs->>'retention_bps' is distinct from tier->>'retentionBonusBps'
  or inputs->>'tier_code' is distinct from tier->>'code' or inputs->>'slots' is distinct from tier->>'slots' then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_TIER_MISMATCH';end if;
 if coalesce(condition.current_allocation_original_id,condition.allocation_original_id) is null then allocation_bps:=0;
 else allocation_bps:=app_private.assert_prospective_allocation(coalesce(condition.current_allocation_original_id,condition.allocation_original_id),condition.user_id,policy.config,(tier->>'slots')::integer);end if;
 if inputs->>'allocation_id' is distinct from coalesce(condition.current_allocation_original_id,condition.allocation_original_id)::text
  or inputs->>'allocation_bps' is distinct from allocation_bps::text
  or inputs->>'allocation_digest' is distinct from(select a.input_digest from app_private.funding_allocation_originals a
   where a.id=coalesce(condition.current_allocation_original_id,condition.allocation_original_id)) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_ARCHIVED_ALLOCATION_MISMATCH';end if;
end;
$$;


commit;
