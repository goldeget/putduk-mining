begin;

--139 OUTSIDE source candidate: immutable native FINALIZE originals only.
create or replace function app_private.assert_principal_portion_clock_original(p_clock uuid) returns void
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
 select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=p_clock;
 select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
 select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
 perform app_private.assert_principal_input_executor(clock.user_id);
 if clock.id is null or portion.user_id is distinct from clock.user_id
  or transition.user_id is distinct from clock.user_id
  or clock.effective_at is distinct from transition.effective_at
  or(clock.status='AVAILABLE' and clock.resumed_at is distinct from clock.effective_at)
  or(clock.status<>'AVAILABLE' and clock.resumed_at is not null) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_portion_transition(transition);
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


create or replace function app_private.assert_verified_input3_clock_original(p_clock uuid) returns void
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
 select c.* into clock from app_private.funding_portion_clock_receipts c where c.id=p_clock;
 select p.* into portion from app_private.funding_principal_portions p where p.id=clock.portion_id;
 select t.* into transition from app_private.funding_portion_transitions t where t.id=clock.transition_id;
 perform app_private.assert_verified_input3_current_executor(clock.user_id);
 if clock.id is null or portion.user_id is distinct from clock.user_id
  or transition.user_id is distinct from clock.user_id
  or clock.effective_at is distinct from transition.effective_at
  or(clock.status='AVAILABLE' and clock.resumed_at is distinct from clock.effective_at)
  or(clock.status<>'AVAILABLE' and clock.resumed_at is not null) then
  raise exception using errcode='55000',message='FUNDING_PRINCIPAL_CLOCK_ORIGINAL_MISMATCH'; end if;
 perform app_private.assert_funding_portion_transition(transition);
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


create or replace function app_private.assert_principal_history_clock_original(p_clock uuid,p_boundary uuid) returns void
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
 perform app_private.assert_principal_history_transition(transition,p_boundary);
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


create or replace function app_private.assert_input3_history_clock_original(p_clock uuid,p_condition uuid) returns void
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
 perform app_private.assert_input3_history_transition(transition,p_condition);
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


create or replace function app_private.assert_principal_history_transition(p_transition app_private.funding_portion_transitions,p_boundary uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 movement public.money_source_movements%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
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
  or p_transition.revision>app_private.principal_snapshot_last_transition(p_boundary)
  or not exists(select 1 from app_private.funding_portion_transitions t where t.id=p_transition.id and to_jsonb(t)=to_jsonb(p_transition)) then
  raise exception using errcode='55000',message='FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED'; end if;
end;
$$;


create or replace function app_private.assert_input3_history_transition(p_transition app_private.funding_portion_transitions,p_condition uuid)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare lot public.funding_principal_lots%rowtype; allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 movement public.money_source_movements%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
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
  or p_transition.revision>app_private.input3_snapshot_last_transition(p_condition)
  or not exists(select 1 from app_private.funding_portion_transitions t where t.id=p_transition.id and to_jsonb(t)=to_jsonb(p_transition)) then
  raise exception using errcode='55000',message='FUNDING_PORTION_SOURCE_COVERAGE_REQUIRED'; end if;
end;
$$;


commit;
