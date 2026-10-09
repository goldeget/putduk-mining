begin;

-- Additive correction to frozen134v1. No new definer or relation/function grant.
-- Native finance remains actual service INVOKER; only completed proof replay
-- enters the two existing guarded owner producers with immutable identities.
create or replace function app_private.assert_member_principal_hold_completion(p_withdrawal uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare request public.withdrawal_requests%rowtype;logical public.withdrawal_logical_requests%rowtype;
 original app_private.withdrawal_principal_confirmation_originals%rowtype;
 typed app_private.funding_principal_recovery_intent_originals%rowtype;hold_admission uuid;
begin
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal;
 select l.* into logical from public.withdrawal_logical_requests l where l.idempotency_key=request.idempotency_key;
 select o.* into original from app_private.withdrawal_principal_confirmation_originals o where o.logical_key=logical.idempotency_key;
 if request.id is null or original.id is null or logical.schema_version is distinct from 3
  or logical.withdrawal_id is distinct from request.id
  or logical.state not in('OUTCOME_UNCERTAIN','CONFIRMED')
  or row(request.user_id,request.currency,request.amount_atomic,request.fee_atomic,request.destination_type,
    request.withdrawal_policy_id,request.withdrawal_destination_id,request.idempotency_key)
   is distinct from row(original.user_id,'KRW'::public.currency_code,original.amount_atomic,0::bigint,original.method,
    original.policy_id,original.destination_id,original.logical_key)
  or request.welcome_reward_conversion_id is not null then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_MEMBER_COMPLETION_REQUIRED';end if;
 perform app_private.assert_withdrawal_principal_confirmation(original.id);
 if request.hold_posted_at is null or request.hold_posted_at<original.confirmed_at
  or request.hold_posted_at>=logical.expires_at then
  raise exception using errcode='55000',message='WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED';end if;
 select i.* into typed from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=request.id;
 if typed.id is null or typed.user_id is distinct from original.user_id or typed.amount_atomic is distinct from original.amount_atomic
  or typed.prepared_at<original.confirmed_at then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_TYPED_COMPLETION_REQUIRED';end if;
 select a.id into hold_admission from app_private.funding_withdrawal_clock_admissions a
  join app_private.funding_principal_boundary_preparations b on b.clock_admission_id=a.id
  join app_private.funding_principal_boundary_completions c on c.boundary_id=b.id
  where a.withdrawal_id=request.id and a.user_id=original.user_id and a.phase='HOLD'
   and b.intent_id=typed.id and b.user_id=original.user_id and c.user_id=original.user_id;
 if hold_admission is null then
  raise exception using errcode='55000',message='WITHDRAWAL_PRINCIPAL_TYPED_COMPLETION_REQUIRED';end if;
 -- Owner integrity triggers retain the direct full original validators.
 -- A genuine service replay reaches those same closed proofs through existing
 -- trusted producer replay paths; archived readers gain no EXECUTE grant.
 if current_user='postgres' then
  perform app_private.assert_principal_recovery_intent_completion(typed.id);
  perform app_private.assert_principal_boundary_complete((select b.id from app_private.funding_principal_boundary_preparations b
   where b.clock_admission_id=hold_admission));
 else
  if current_user is distinct from 'service_role' or auth.role() is distinct from 'service_role'
   or(auth.uid() is not null and auth.uid() is distinct from original.user_id) then
   raise exception using errcode='42501',message='WITHDRAWAL_PRINCIPAL_SERVICE_AUTH_REQUIRED';end if;
  -- Both selected immutable originals already exist. Existing producers return
  -- before fresh admission/clock/finance: exact type and exact completed cause.
  perform app_private.prepare_principal_recovery_intent(request.id,typed.journal_request_id);
  perform app_private.finish_principal_runtime_boundary(hold_admission);
 end if;
end;
$$;

revoke all on function app_private.assert_member_principal_hold_completion(uuid) from public,anon,authenticated;
grant execute on function app_private.assert_member_principal_hold_completion(uuid) to service_role;

commit;
