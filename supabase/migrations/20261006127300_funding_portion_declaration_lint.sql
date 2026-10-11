begin;

-- Explicit JSONB declaration types only. Both bodies from BEGIN onward are
-- byte-identical to the applied 127000 originals; replacement retains ACL/owner.

create or replace function app_private.verify_funding_portion_fact(p_transition app_private.funding_portion_transitions) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare allocation public.funding_principal_recovery_allocations%rowtype;
 release public.funding_principal_recovery_releases%rowtype; request public.withdrawal_requests%rowtype;
 candidate record; expected jsonb:='[]'::jsonb; actual jsonb; left_micro bigint; take_micro bigint; amount_micro bigint;
begin
 perform app_private.assert_funding_portion_transition(p_transition);
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

create or replace function app_private.assert_funding_portion_lot_order(p_hold uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare hold record; lot record; remaining bigint; take_micro bigint; expected jsonb:='[]'::jsonb; actual jsonb;
begin
 select user_id,sum(allocation_micro_krw)::bigint as amount,min(effective_at) as effective_at,max(effective_at) as latest
 into hold from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=p_hold group by user_id;
 if hold.user_id is null or hold.effective_at is distinct from hold.latest
  or(select count(distinct user_id) from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=p_hold)<>1 then
  raise exception using errcode='55000',message='FUNDING_PORTION_HOLD_ORIGINAL_REQUIRED'; end if;
 remaining:=hold.amount;
 for lot in select p.id,p.amount_micro_krw-coalesce((select sum(a.allocation_micro_krw) from public.funding_principal_recovery_allocations a
   where a.lot_id=p.id and a.hold_ledger_transaction_id<>p_hold and a.effective_at<=hold.effective_at
    and not exists(select 1 from public.funding_principal_recovery_releases r
     where r.hold_ledger_transaction_id=a.hold_ledger_transaction_id and r.effective_at<=hold.effective_at)),0) as available
  from public.funding_principal_lots p where p.user_id=hold.user_id and p.effective_at<=hold.effective_at
  order by p.effective_at desc,p.recorded_at desc,p.id desc loop
  if lot.available<0 then raise exception using errcode='55000',message='FUNDING_PORTION_LOT_BALANCE_INVALID'; end if;
  take_micro:=least(remaining,lot.available);
  if take_micro>0 then expected:=expected||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'amount_micro_krw',take_micro::text)); end if;
  remaining:=remaining-take_micro; exit when remaining=0;
 end loop;
 select jsonb_agg(jsonb_build_object('lot_id',lot_id,'amount_micro_krw',allocation_micro_krw::text) order by ordinal) into actual
 from public.funding_principal_recovery_allocations where hold_ledger_transaction_id=p_hold;
 if remaining<>0 or expected is distinct from actual then
  raise exception using errcode='55000',message='FUNDING_PORTION_NEWEST_LOT_ORDER_REQUIRED'; end if;
end;
$$;

commit;
