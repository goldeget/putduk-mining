begin;

-- Preserve existing owner/INV/fixed-path/ACL. No raw metadata authority.
create or replace function app_private.guard_funding_withdrawal_clock_original_links() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare admission app_private.funding_withdrawal_clock_admissions%rowtype; journal public.ledger_transactions%rowtype;
begin
 if tg_table_schema='public' and tg_table_name='audit_logs' then
  if exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.audit_id=old.id) then
   raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_AUDIT_IMMUTABLE'; end if;
 elsif tg_table_schema='public' and tg_table_name='outbox_events' then
  if exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.source_event_id=old.id)
   and(tg_op='DELETE' or to_jsonb(new)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
     is distinct from to_jsonb(old)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']) then
   raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_EVENT_IMMUTABLE'; end if;
 elsif tg_table_schema='public' and tg_table_name='withdrawal_requests' then
  if exists(select 1 from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=old.id)
   and(tg_op='DELETE' or app_private.funding_withdrawal_request_snapshot(new)
    is distinct from app_private.funding_withdrawal_request_snapshot(old)
    or(old.hold_ledger_transaction_id is not null and new.hold_ledger_transaction_id is distinct from old.hold_ledger_transaction_id)
    or(old.release_ledger_transaction_id is not null and new.release_ledger_transaction_id is distinct from old.release_ledger_transaction_id)
    or(old.hold_posted_at is not null and new.hold_posted_at is distinct from old.hold_posted_at)
    or(old.hold_released_at is not null and new.hold_released_at is distinct from old.hold_released_at)
    or(old.finalize_ledger_transaction_id is not null and new.finalize_ledger_transaction_id is distinct from old.finalize_ledger_transaction_id)
    or(old.ledger_finalized_at is not null and new.ledger_finalized_at is distinct from old.ledger_finalized_at)) then
   raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_REQUEST_ORIGINAL_IMMUTABLE'; end if;
  if tg_op='UPDATE' and old.finalize_ledger_transaction_id is null and new.finalize_ledger_transaction_id is not null
   and exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=new.id) then
   -- Actual closed table receipt, not a service-writable metadata flag. This
   -- BEFORE request link check cannot yet call full AFTER-finance completion;
   -- the existing deferred admission trigger proves that complete original.
   select a.* into admission from app_private.funding_withdrawal_clock_admissions a
    where a.withdrawal_id=new.id and a.user_id=new.user_id and a.phase='FINALIZE';
   select t.* into journal from public.ledger_transactions t where t.id=new.finalize_ledger_transaction_id;
   if admission.id is null or admission.amount_atomic is distinct from new.amount_atomic+new.fee_atomic
    or admission.request_snapshot is distinct from app_private.funding_withdrawal_request_snapshot(new)
    or admission.hold_admission_id is distinct from(select a.id from app_private.funding_withdrawal_clock_admissions a
     where a.withdrawal_id=new.id and a.user_id=new.user_id and a.phase='HOLD')
    or journal.member_user_id is distinct from new.user_id or journal.reference_type is distinct from 'withdrawal_request'
    or journal.reference_id is distinct from new.id or journal.request_id is distinct from admission.journal_request_id
    or journal.metadata->>'phase' is distinct from 'FINALIZE'
    or journal.metadata->>'portion_clock_contract' is distinct from 'HOLD_CANCEL_FINALIZE_V1'
    or journal.metadata->>'clock_admission_id' is distinct from admission.id::text
    or journal.metadata->>'admitted_at_microseconds' is distinct from((extract(epoch from admission.effective_at)*1000000)::bigint)::text
    or journal.posted_at is distinct from admission.effective_at or journal.created_at is distinct from admission.effective_at
    or new.ledger_finalized_at is distinct from admission.effective_at or new.status is distinct from 'COMPLETED'
    or new.release_ledger_transaction_id is not null then
    raise exception using errcode='55000',message='FUNDING_FINALIZE_CLOCK_ADMISSION_REQUIRED';end if;
  end if;
 else raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_LINK_CONTEXT_INVALID'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;

commit;
