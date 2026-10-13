-- Forward-only fix: remove an unused local variable that shadows the SQL binding alias.
-- Existing migration, public wrappers, ACL, SECURITY DEFINER and fixed search_path remain preserved.
begin;
create or replace function app_private.apply_member_push_binding(
  p_user_id uuid,p_auth_session_id uuid,p_operation text,p_endpoint text,
  p_p256dh text,p_auth_secret text,p_expires_at timestamptz,p_user_agent text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at timestamptz;sid uuid;rid uuid;digest text;
  v_scope text;fresh boolean:=false;
begin
  perform app_private.assert_push_worker_context(); -- exact service_role context, no send approval implied
  if p_user_id is null or p_auth_session_id is null or p_operation is null
    or p_operation not in('REGISTER','REVOKE','LOGOUT_LOCAL','LOGOUT_GLOBAL') then
    raise exception using errcode='22023',message='INVALID_PUSH_BINDING_COMMAND';end if;
  -- Same order for all user configuration operations. Worker admission uses a
  -- try-lock with this same recipient key and never waits holding a delivery row.
  perform pg_advisory_xact_lock(hashtextextended('putduk-push-recipient:'||p_user_id::text,0));
  at:=clock_timestamp();
  if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_auth_session_id and s.user_id=p_user_id and(s.not_after is null or s.not_after>at)
      and u.deleted_at is null and(u.banned_until is null or u.banned_until<=at)) then
    raise exception using errcode='42501',message='PUSH_ACTIVE_SESSION_REQUIRED';end if;

  if p_operation in('REGISTER','REVOKE') then
    if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint)>2048 then
      raise exception using errcode='22023',message='INVALID_PUSH_SUBSCRIPTION';end if;
    digest:=encode(extensions.digest(p_endpoint,'sha256'),'hex');
    perform pg_advisory_xact_lock(hashtextextended('putduk-push-endpoint:'||digest,0));
  elsif p_endpoint is not null or p_p256dh is not null or p_auth_secret is not null
    or p_expires_at is not null or p_user_agent is not null then
    raise exception using errcode='22023',message='INVALID_PUSH_BINDING_COMMAND';
  end if;

  if p_operation in('REGISTER','REVOKE') then
    raise exception using errcode='42501',message='PUSH_ENDPOINT_EPOCH_REQUIRED';
  else
    v_scope:=case p_operation when 'LOGOUT_LOCAL' then 'LOCAL' else 'GLOBAL' end;
    insert into app_private.push_session_fences(user_id,auth_session_id,scope,cutoff,receipt_id)
      values(p_user_id,p_auth_session_id,v_scope,at,gen_random_uuid())on conflict(user_id,auth_session_id,scope)do nothing
      returning receipt_id into rid;
    fresh:=rid is not null;
    if rid is null then select receipt_id into rid from app_private.push_session_fences f
      where f.user_id=p_user_id and f.auth_session_id=p_auth_session_id and f.scope=v_scope;end if;
    update public.push_subscriptions s set revoked_at=at
      where s.user_id=p_user_id and s.revoked_at is null and exists(select 1 from app_private.push_subscription_bindings b
        where b.subscription_id=s.id and b.user_id=p_user_id
          and not app_private.push_session_is_admissible(p_user_id,b.auth_session_id));
  end if;

  if p_operation<>'REGISTER' and not exists(select 1 from public.push_subscriptions s
    where s.user_id=p_user_id and app_private.push_binding_send_allowed(s.id)) then
    update public.notification_preferences set web_push_enabled=false where user_id=p_user_id;
  end if;
  if fresh then
    insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state)
      values(rid,p_user_id,'PUSH_BINDING_'||p_operation,'push_binding',rid::text,
        '회원의 명시적인 기기 알림 설정 또는 로그아웃',rid,
        jsonb_build_object('operation',p_operation,'scope',v_scope,'auth_session_id',p_auth_session_id));
  end if;
  return jsonb_build_object('subscribed',p_operation='REGISTER','operation',p_operation,'scope',v_scope,
    'authSessionId',p_auth_session_id,'receiptId',rid,'subscriptionId',sid);
end;$$;

-- Current compatibility closures and immutable scalar evidence comparisons.
create or replace function app_private.assert_usdt_manual_full_payout(
  p_withdrawal uuid, p_requested_krw bigint, p_fee_krw bigint,
  p_network text, p_actual_usdt numeric, p_evidence jsonb
) returns void language plpgsql immutable security invoker
set search_path=pg_catalog as $$
begin
  if p_evidence is null then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_EVIDENCE_REQUIRED';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'object'
    or p_evidence - array['version','basis','withdrawalId','requestedKrwAmount',
      'actualUsdtAmount','network','feeKrw','fullPayoutConfirmed'] <> '{}'::jsonb
    or p_evidence->'version' is distinct from '1'::jsonb
    or p_evidence->'basis' is distinct from '"OPERATOR_MANUAL_FULL_PAYOUT"'::jsonb
    or p_evidence->'fullPayoutConfirmed' is distinct from 'true'::jsonb
    or p_evidence->'feeKrw' is distinct from '"0"'::jsonb
    or jsonb_typeof(p_evidence->'requestedKrwAmount') is distinct from 'string'
    or coalesce(p_evidence->>'requestedKrwAmount','') !~ '^[1-9][0-9]{0,18}$'
    or jsonb_typeof(p_evidence->'actualUsdtAmount') is distinct from 'string'
    or coalesce(p_evidence->>'actualUsdtAmount','') !~ '^(0|[1-9][0-9]{0,31})([.][0-9]{0,5}[1-9])?$'
    or case when p_withdrawal::text is null
      then p_evidence->'withdrawalId' is not null
      else jsonb_typeof(p_evidence->'withdrawalId') is distinct from 'string'
        or p_evidence->>'withdrawalId' is distinct from p_withdrawal::text
      end
    or case when p_network is null
      then p_evidence->'network' is not null
      else jsonb_typeof(p_evidence->'network') is distinct from 'string'
        or p_evidence->>'network' is distinct from p_network
      end then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID';
  end if;
  if p_withdrawal is null or p_requested_krw is null or p_requested_krw<=0
    or p_fee_krw is distinct from 0
    or p_evidence->>'requestedKrwAmount' is distinct from p_requested_krw::text then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH';
  end if;
  if p_network is null or p_network not in ('TRC20','ERC20','BEP20')
    or p_actual_usdt is null or p_actual_usdt::text in ('NaN','Infinity','-Infinity')
    or p_actual_usdt<=0 or scale(p_actual_usdt)>6
    or (p_evidence->>'actualUsdtAmount')::numeric is distinct from p_actual_usdt then
    raise exception using errcode='22023',message='USDT_MANUAL_FULL_PAYOUT_AMOUNT_MISMATCH';
  end if;
end;
$$;

create or replace function public.upsert_push_subscription(
  p_user_id uuid,p_endpoint text,p_p256dh text,p_auth_secret text,p_expires_at timestamptz,p_user_agent text)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
begin
  -- Compatibility parameters remain named; this retired unbound command never writes.
  perform p_user_id,p_endpoint,p_p256dh,p_auth_secret,p_expires_at,p_user_agent;
  raise exception using errcode='42501',message='PUSH_SESSION_BINDING_REQUIRED';
end;$$;
create or replace function public.revoke_push_subscription(p_user_id uuid,p_endpoint text)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
begin
  -- Compatibility parameters remain named; this retired unbound command never writes.
  perform p_user_id,p_endpoint;
  raise exception using errcode='42501',message='PUSH_SESSION_BINDING_REQUIRED';
end;$$;

commit;
