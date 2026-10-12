-- DRAFT ONLY: no CLI migration created, no database execution. This adds
-- service transport RPCs, not aliases for frozen WS-04 business commands.
begin;
create table app_private.push_endpoint_epochs (
  endpoint_digest text primary key check(endpoint_digest ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id),epoch bigint not null default 0
    check(epoch between 0 and 9007199254740991), enabled boolean not null default false
);
create table app_private.push_enable_permits (
  intent_id uuid primary key,user_id uuid not null references auth.users(id),
  auth_session_id uuid not null,endpoint_digest text not null,
  payload_digest text not null,expected_epoch bigint not null,
  permit_id uuid not null unique,receipt_id uuid not null unique,
  issued_at timestamptz not null,expires_at timestamptz not null
);
create table app_private.push_endpoint_revocations (
  intent_id uuid primary key,user_id uuid not null references auth.users(id),
  auth_session_id uuid not null,endpoint_digest text not null,
  revoked_epoch bigint not null,receipt_id uuid not null unique,revoked_at timestamptz not null
);
create table app_private.push_session_fences (
  user_id uuid not null references auth.users(id), auth_session_id uuid not null,
  scope text not null check(scope in('LOCAL','GLOBAL')), cutoff timestamptz not null,
  receipt_id uuid not null unique, primary key(user_id,auth_session_id,scope)
);
create table app_private.push_subscription_bindings (
  subscription_id uuid primary key references public.push_subscriptions(id),
  user_id uuid not null references auth.users(id),auth_session_id uuid not null,
  receipt_id uuid not null unique,subscription_digest text not null,
  bound_at timestamptz not null,endpoint_epoch bigint not null,check(subscription_digest ~ '^[a-f0-9]{64}$')
);
alter table app_private.push_endpoint_epochs enable row level security;
alter table app_private.push_endpoint_epochs force row level security;
alter table app_private.push_enable_permits enable row level security;
alter table app_private.push_enable_permits force row level security;
alter table app_private.push_endpoint_revocations enable row level security;
alter table app_private.push_endpoint_revocations force row level security;
alter table app_private.push_session_fences enable row level security;
alter table app_private.push_session_fences force row level security;
alter table app_private.push_subscription_bindings enable row level security;
alter table app_private.push_subscription_bindings force row level security;
revoke all on app_private.push_endpoint_epochs,app_private.push_enable_permits,
  app_private.push_endpoint_revocations,app_private.push_session_fences,
  app_private.push_subscription_bindings from public,anon,authenticated,service_role;
create trigger push_permit_append_only before update or delete on app_private.push_enable_permits
  for each row execute function app_private.prevent_row_mutation();
create trigger push_revocation_append_only before update or delete on app_private.push_endpoint_revocations
  for each row execute function app_private.prevent_row_mutation();
create trigger push_session_fence_append_only before update or delete on app_private.push_session_fences
  for each row execute function app_private.prevent_row_mutation();

-- Bind the enqueue generation. Re-enabling the same endpoint and keys cannot
-- adopt a delivery claimed under an older explicit enable intent.
alter table app_private.notification_device_deliveries add column endpoint_epoch bigint;
create function app_private.bind_push_delivery_epoch() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' then
  if new.endpoint_epoch is distinct from old.endpoint_epoch then
   raise exception using errcode='55000',message='PUSH_DELIVERY_EPOCH_IMMUTABLE';end if;
 else
  select b.endpoint_epoch into new.endpoint_epoch from app_private.push_subscription_bindings b
   where b.subscription_id=new.subscription_id and b.user_id=new.user_id;
 end if;
 return new;
end;$$;
revoke all on function app_private.bind_push_delivery_epoch()from public,anon,authenticated,service_role;
create trigger push_delivery_epoch_immutable before insert or update on app_private.notification_device_deliveries
 for each row execute function app_private.bind_push_delivery_epoch();

create function app_private.push_session_is_admissible(p_user uuid,p_session uuid)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session and s.user_id=p_user
    and(s.not_after is null or s.not_after>clock_timestamp())
    and u.deleted_at is null and(u.banned_until is null or u.banned_until<=clock_timestamp())
    and not exists(select 1 from public.block_rules b where b.user_id=p_user and b.scope='ACCOUNT'
      and b.starts_at<=clock_timestamp() and(b.ends_at is null or b.ends_at>clock_timestamp()))
    and not exists(select 1 from app_private.push_session_fences f where f.user_id=p_user
      and((f.scope='LOCAL' and f.auth_session_id=p_session)or(f.scope='GLOBAL' and s.created_at<=f.cutoff))))
$$;

create function app_private.push_binding_send_allowed(p_subscription uuid)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select exists(select 1 from public.push_subscriptions s
    join app_private.push_subscription_bindings b on b.subscription_id=s.id and b.user_id=s.user_id
    where s.id=p_subscription and s.revoked_at is null
      and(s.expires_at is null or s.expires_at>clock_timestamp())
      and b.subscription_digest=app_private.push_subscription_digest(s.id)
      and app_private.push_session_is_admissible(s.user_id,b.auth_session_id)
      and exists(select 1 from app_private.push_endpoint_epochs e where e.user_id=s.user_id
        and e.endpoint_digest=encode(extensions.digest(s.endpoint,'sha256'),'hex')
        and e.enabled and e.epoch=b.endpoint_epoch))
$$;

create function app_private.apply_member_push_binding(
  p_user_id uuid,p_auth_session_id uuid,p_operation text,p_endpoint text,
  p_p256dh text,p_auth_secret text,p_expires_at timestamptz,p_user_agent text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at timestamptz;sid uuid;rid uuid;digest text;b app_private.push_subscription_bindings%rowtype;
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

create function public.apply_member_push_binding(
  p_user_id uuid,p_auth_session_id uuid,p_operation text,p_endpoint text,
  p_p256dh text,p_auth_secret text,p_expires_at timestamptz,p_user_agent text
) returns jsonb language sql security invoker set search_path=pg_catalog
return app_private.apply_member_push_binding(p_user_id,p_auth_session_id,p_operation,
  p_endpoint,p_p256dh,p_auth_secret,p_expires_at,p_user_agent);


create function app_private.member_push_endpoint_command(
 p_user_id uuid,p_auth_session_id uuid,p_operation text,p_endpoint text,
 p_p256dh text,p_auth_secret text,p_expires_at timestamptz,p_user_agent text,
 p_expected_epoch bigint,p_intent_id uuid,p_permit_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at timestamptz;ed text;pd text;e app_private.push_endpoint_epochs%rowtype;
 q app_private.push_enable_permits%rowtype;r app_private.push_endpoint_revocations%rowtype;
 sid uuid;rid uuid;fresh boolean:=false;v_epoch bigint;v_subscribed boolean;
begin
 perform app_private.assert_push_worker_context();
 if p_user_id is null or p_auth_session_id is null or p_operation is null
  or p_operation not in('SNAPSHOT','ISSUE','REGISTER','REVOKE')
  or p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint)>2048 then
  raise exception using errcode='22023',message='INVALID_PUSH_BINDING_COMMAND';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-push-recipient:'||p_user_id::text,0));
 ed:=encode(extensions.digest(p_endpoint,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('putduk-push-endpoint:'||ed,0));
 at:=clock_timestamp();
 if not app_private.push_session_is_admissible(p_user_id,p_auth_session_id) then
  raise exception using errcode='42501',message='PUSH_SESSION_REVOKED';end if;
 if exists(select 1 from public.push_subscriptions x where x.endpoint=p_endpoint and x.user_id<>p_user_id)
  or exists(select 1 from app_private.push_endpoint_epochs x where x.endpoint_digest=ed and x.user_id<>p_user_id)then
  raise exception using errcode='23505',message='PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT';end if;
 select * into e from app_private.push_endpoint_epochs where endpoint_digest=ed;
 v_epoch:=coalesce(e.epoch,0);v_subscribed:=coalesce(e.enabled,false);
 if p_operation='SNAPSHOT' then
  if p_expected_epoch is not null or p_intent_id is not null or p_permit_id is not null
    or p_p256dh is not null or p_auth_secret is not null or p_expires_at is not null or p_user_agent is not null then
   raise exception using errcode='22023',message='INVALID_PUSH_BINDING_COMMAND';end if;
  return jsonb_build_object('operation','SNAPSHOT','authSessionId',p_auth_session_id,
   'endpointEpoch',v_epoch,'subscribed',v_subscribed and exists(select 1 from public.push_subscriptions x
    where x.endpoint=p_endpoint and app_private.push_binding_send_allowed(x.id)));
 end if;
 if p_intent_id is null then raise exception using errcode='22023',message='PUSH_INTENT_REQUIRED';end if;
 if p_operation='REVOKE' then
  if p_expected_epoch is not null or p_permit_id is not null or p_p256dh is not null
   or p_auth_secret is not null or p_expires_at is not null or p_user_agent is not null then
   raise exception using errcode='22023',message='INVALID_PUSH_BINDING_COMMAND';end if;
  select * into r from app_private.push_endpoint_revocations where intent_id=p_intent_id;
  if r.intent_id is not null then
   if r.user_id<>p_user_id or r.auth_session_id<>p_auth_session_id or r.endpoint_digest<>ed then
    raise exception using errcode='42501',message='PUSH_INTENT_MISMATCH';end if;
   if r.revoked_epoch<>v_epoch or v_subscribed then
    raise exception using errcode='55000',message='PUSH_REVOKE_SUPERSEDED';end if;
   rid:=r.receipt_id;
  else
   if v_epoch>=9007199254740991 then raise exception using errcode='55000',message='PUSH_EPOCH_EXHAUSTED';end if;
   v_epoch:=v_epoch+1;rid:=gen_random_uuid();fresh:=true;
   insert into app_private.push_endpoint_epochs(endpoint_digest,user_id,epoch,enabled)
    values(ed,p_user_id,v_epoch,false)on conflict(endpoint_digest)do update set epoch=excluded.epoch,enabled=false;
   insert into app_private.push_endpoint_revocations values(p_intent_id,p_user_id,p_auth_session_id,ed,v_epoch,rid,at);
   update public.push_subscriptions set revoked_at=at where user_id=p_user_id and endpoint=p_endpoint and revoked_at is null;
  end if;
  if not exists(select 1 from public.push_subscriptions x where x.user_id=p_user_id
   and app_private.push_binding_send_allowed(x.id))then
   update public.notification_preferences set web_push_enabled=false where user_id=p_user_id;end if;
 else
  if p_expected_epoch is null or p_expected_epoch<0 or p_expected_epoch>=9007199254740991
   or p_p256dh is null or char_length(p_p256dh) not between 32 and 512
   or p_auth_secret is null or char_length(p_auth_secret) not between 8 and 256
   or char_length(coalesce(p_user_agent,''))>512
   or(p_expires_at is not null and(not isfinite(p_expires_at)or p_expires_at<=at))then
   raise exception using errcode='22023',message='INVALID_PUSH_SUBSCRIPTION';end if;
  pd:=encode(extensions.digest(jsonb_build_array(p_user_id,p_auth_session_id,p_endpoint,
   p_p256dh,p_auth_secret,extract(epoch from p_expires_at),coalesce(p_user_agent,''))::text,'sha256'),'hex');
  select * into q from app_private.push_enable_permits where intent_id=p_intent_id;
  if q.intent_id is not null and(q.user_id<>p_user_id or q.auth_session_id<>p_auth_session_id
   or q.endpoint_digest<>ed or q.payload_digest<>pd or q.expected_epoch<>p_expected_epoch)then
   raise exception using errcode='42501',message='PUSH_INTENT_MISMATCH';end if;
  if p_operation='ISSUE' then
   if p_permit_id is not null then raise exception using errcode='22023',message='INVALID_PUSH_BINDING_COMMAND';end if;
   if v_epoch<>p_expected_epoch then raise exception using errcode='55000',message='PUSH_EPOCH_STALE';end if;
   if q.intent_id is null then
    insert into app_private.push_endpoint_epochs(endpoint_digest,user_id)values(ed,p_user_id)
     on conflict(endpoint_digest)do nothing;
    insert into app_private.push_enable_permits values(p_intent_id,p_user_id,p_auth_session_id,ed,pd,p_expected_epoch,
     gen_random_uuid(),gen_random_uuid(),at,at+interval '10 minutes')returning * into q;
   elsif q.expires_at<=at then raise exception using errcode='55000',message='PUSH_PERMIT_EXPIRED';end if;
   return jsonb_build_object('operation','ISSUE','authSessionId',p_auth_session_id,'endpointEpoch',v_epoch,
    'intentId',q.intent_id,'permitId',q.permit_id);
  end if;
  if q.intent_id is null or p_permit_id is distinct from q.permit_id or q.expires_at<=at then
   raise exception using errcode='42501',message='PUSH_PERMIT_INVALID';end if;
  rid:=q.receipt_id;
  if v_epoch=q.expected_epoch+1 and v_subscribed then
   select x.id into sid from public.push_subscriptions x join app_private.push_subscription_bindings b on b.subscription_id=x.id
    where x.endpoint=p_endpoint and x.user_id=p_user_id and b.receipt_id=q.receipt_id
    and b.auth_session_id=p_auth_session_id and b.endpoint_epoch=v_epoch and app_private.push_binding_send_allowed(x.id);
   if sid is null then raise exception using errcode='55000',message='PUSH_EPOCH_STALE';end if;
  else
   if v_epoch<>q.expected_epoch then raise exception using errcode='55000',message='PUSH_EPOCH_STALE';end if;
   insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_secret,expires_at,user_agent)
    values(p_user_id,p_endpoint,p_p256dh,p_auth_secret,p_expires_at,nullif(p_user_agent,''))
    on conflict(endpoint)do update set p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
     expires_at=excluded.expires_at,user_agent=excluded.user_agent,revoked_at=null where public.push_subscriptions.user_id=excluded.user_id
    returning id into sid;
   if sid is null then raise exception using errcode='23505',message='PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT';end if;
   v_epoch:=v_epoch+1;fresh:=true;
   update app_private.push_endpoint_epochs set epoch=v_epoch,enabled=true where endpoint_digest=ed and user_id=p_user_id;
   insert into app_private.push_subscription_bindings(subscription_id,user_id,auth_session_id,receipt_id,subscription_digest,bound_at,endpoint_epoch)
    values(sid,p_user_id,p_auth_session_id,rid,app_private.push_subscription_digest(sid),at,v_epoch)
    on conflict(subscription_id)do update set user_id=excluded.user_id,auth_session_id=excluded.auth_session_id,
     receipt_id=excluded.receipt_id,subscription_digest=excluded.subscription_digest,bound_at=excluded.bound_at,endpoint_epoch=excluded.endpoint_epoch;
   insert into public.notification_preferences(user_id,web_push_enabled)values(p_user_id,true)
    on conflict(user_id)do update set web_push_enabled=true;
  end if;
 end if;
 if fresh then insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state)
  values(rid,p_user_id,'PUSH_ENDPOINT_'||p_operation,'push_binding',rid::text,
   '회원의 명시적인 기기 알림 설정',rid,jsonb_build_object('operation',p_operation,
   'auth_session_id',p_auth_session_id,'endpoint_epoch',v_epoch));end if;
 return jsonb_build_object('subscribed',p_operation='REGISTER','operation',p_operation,
  'scope',case p_operation when 'REGISTER'then 'CURRENT_SESSION'else 'CURRENT_ENDPOINT'end,
  'authSessionId',p_auth_session_id,'receiptId',rid,'subscriptionId',sid,'endpointEpoch',v_epoch,
  'intentId',p_intent_id,'permitId',case when p_operation='REGISTER'then p_permit_id else null end);
end;$$;
create function public.member_push_endpoint_command(
 p_user_id uuid,p_auth_session_id uuid,p_operation text,p_endpoint text,
 p_p256dh text,p_auth_secret text,p_expires_at timestamptz,p_user_agent text,
 p_expected_epoch bigint,p_intent_id uuid,p_permit_id uuid
) returns jsonb language sql security invoker set search_path=pg_catalog
return app_private.member_push_endpoint_command(p_user_id,p_auth_session_id,p_operation,p_endpoint,
 p_p256dh,p_auth_secret,p_expires_at,p_user_agent,p_expected_epoch,p_intent_id,p_permit_id);
revoke all on function app_private.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamptz,text,bigint,uuid,uuid),
 public.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamptz,text,bigint,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function app_private.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamptz,text,bigint,uuid,uuid),
 public.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamptz,text,bigint,uuid,uuid)to service_role;

-- Preserve old signatures and return types; they cannot be a second unbound
-- writer that bypasses the session fence. New API calls only the internal RPC.
create or replace function public.upsert_push_subscription(
  p_user_id uuid,p_endpoint text,p_p256dh text,p_auth_secret text,p_expires_at timestamptz,p_user_agent text)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='42501',message='PUSH_SESSION_BINDING_REQUIRED';end;$$;
create or replace function public.revoke_push_subscription(p_user_id uuid,p_endpoint text)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='42501',message='PUSH_SESSION_BINDING_REQUIRED';end;$$;

create function app_private.check_push_delivery_admission(
  p_delivery_id uuid,p_worker_id text,p_lease_token uuid,p_attempt integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d app_private.notification_device_deliveries%rowtype;at timestamptz:=clock_timestamp();allowed boolean:=false;
begin
  perform app_private.assert_push_worker_context();
  select * into d from app_private.notification_device_deliveries where id=p_delivery_id;
  if d.id is null or d.status<>'LEASED' or d.lease_owner is distinct from p_worker_id
    or d.lease_token is distinct from p_lease_token or d.attempt_count is distinct from p_attempt
    or d.lease_expires_at<=at then raise exception using errcode='55000',message='PUSH_LEASE_STALE';end if;
  if pg_try_advisory_xact_lock(hashtextextended('putduk-push-recipient:'||d.user_id::text,0)) then
    allowed:=app_private.push_binding_send_allowed(d.subscription_id)
      and d.subscription_digest=app_private.push_subscription_digest(d.subscription_id)
      and app_private.push_send_available_at(d.id,at)<=at;
  end if;
  return jsonb_build_object('deliveryId',d.id,'allowed',coalesce(allowed,false));
end;$$;
create function public.check_push_delivery_admission(
  p_delivery_id uuid,p_worker_id text,p_lease_token uuid,p_attempt integer
) returns jsonb language sql security invoker set search_path=pg_catalog
return app_private.check_push_delivery_admission(p_delivery_id,p_worker_id,p_lease_token,p_attempt);

revoke all on function app_private.push_session_is_admissible(uuid,uuid),
  app_private.push_binding_send_allowed(uuid),
  app_private.apply_member_push_binding(uuid,uuid,text,text,text,text,timestamptz,text),
  public.apply_member_push_binding(uuid,uuid,text,text,text,text,timestamptz,text),
  app_private.check_push_delivery_admission(uuid,text,uuid,integer),
  public.check_push_delivery_admission(uuid,text,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function app_private.apply_member_push_binding(uuid,uuid,text,text,text,text,timestamptz,text),
  public.apply_member_push_binding(uuid,uuid,text,text,text,text,timestamptz,text),
  app_private.check_push_delivery_admission(uuid,text,uuid,integer),
  public.check_push_delivery_admission(uuid,text,uuid,integer)to service_role;

-- Parent generator appends CREATE OR REPLACE of the exact latest
-- push_send_available_at body with one reviewed binding eligibility predicate.
-- See worker-eligibility.sql.draft; both drafts belong in one real migration.
-- DRAFT continuation, include before COMMIT in the binding migration.
create or replace function app_private.push_send_available_at(p_delivery uuid,p_now timestamptz)
returns timestamptz language plpgsql security invoker set search_path=pg_catalog as $$
declare d app_private.notification_device_deliveries%rowtype;n public.notifications%rowtype;
 s public.push_subscriptions%rowtype;p public.notification_preferences%rowtype;
 local_now timestamp;local_time time;quiet boolean;allowed boolean;
 daily_count integer;last_category_at timestamptz;deferred_at timestamptz;
begin
 select * into d from app_private.notification_device_deliveries where id=p_delivery;
 select * into n from public.notifications where id=d.notification_id;
 select * into s from public.push_subscriptions where id=d.subscription_id;
 select * into p from public.notification_preferences where user_id=d.user_id;
 if d.id is null or n.id is null or s.id is null or p.user_id is null
  or n.user_id is distinct from d.user_id or s.user_id is distinct from d.user_id
  or d.endpoint_epoch is distinct from(select b.endpoint_epoch from app_private.push_subscription_bindings b where b.subscription_id=s.id)
  or not app_private.push_binding_send_allowed(s.id)
  or s.revoked_at is not null or(s.expires_at is not null and s.expires_at<=p_now)
  or(n.expires_at is not null and n.expires_at<=p_now) or not p.web_push_enabled
  or not exists(select 1 from auth.users where id=d.user_id and deleted_at is null
    and(banned_until is null or banned_until<=p_now))
  or exists(select 1 from public.block_rules where user_id=d.user_id and scope='ACCOUNT'
    and starts_at<=p_now and(ends_at is null or ends_at>p_now))
  or not exists(select 1 from pg_catalog.pg_timezone_names where name=p.timezone)
  or not exists(select 1 from public.outbox_events where id=n.source_event_id)
 then return null;end if;
 allowed:=case
  when n.category in('event_rewards','events','event','notices','notice') then p.events_enabled
  when n.category in('mining','trial','mining_milestones','trial_milestones') then p.mining_enabled
  when n.category in('wallet','deposits','withdrawals','funding','referrals') then p.wallet_enabled
  when n.category in('service','security','maintenance') then p.service_enabled
  when n.category='marketing' then p.marketing_enabled
  else false end;
 if not allowed then return null;end if;
 if n.category='event_rewards' then
  if not exists(select 1 from app_private.nonmoney_reward_notification_originals where notification_id=n.id and source_event_id=n.source_event_id and user_id=d.user_id and outcome='PERSISTED')then return null;end if;
 elsif n.category in('events','notices') then
  if not exists(select 1 from app_private.liveops_publication_notification_originals where notification_id=n.id and source_event_id=n.source_event_id and user_id=d.user_id and outcome='PERSISTED')then return null;end if;
  perform app_private.assert_liveops_publication_notification((select id from app_private.liveops_publication_notification_originals where notification_id=n.id and user_id=d.user_id));
 elsif n.category in('wallet','mining','trial') then
  if not exists(select 1 from app_private.domain_notification_originals o
   where o.notification_id=n.id and o.source_event_id=n.source_event_id and o.user_id=d.user_id and o.outcome='PERSISTED')then return null;end if;
  perform app_private.assert_domain_notification(n.source_event_id);
 else return null;end if;
 -- Reward source must remain bound to its immutable published event revision.
 if n.category='event_rewards' and not exists(
  select 1 from public.member_event_awards a
  join app_private.nonmoney_event_policies policy on policy.id=a.policy_id
  join public.events event on event.id=a.event_id
  join public.event_member_content content on content.event_id=event.id and content.revision_id=policy.content_revision_id
  where a.user_id=d.user_id and a.outbox_id=n.source_event_id
    and event.status in('SCHEDULED','LIVE','ENDED') and event.published_at is not null
    and not exists(select 1 from app_private.liveops_content_receipts newer
      join app_private.liveops_content_receipts approved on approved.id=policy.content_revision_id
      where newer.content_id=event.id and newer.revision>approved.revision)
 ) then return null;end if;
 if n.category='event_rewards' then
  perform app_private.assert_nonmoney_notification((select id from public.member_event_awards
   where outbox_id=n.source_event_id and user_id=d.user_id));
 end if;
 -- Canonical CMS cancellation/archive must suppress publication notifications too.
 if exists(select 1 from public.outbox_events e where e.id=n.source_event_id
  and e.aggregate_type='liveops_content' and not exists(
   select 1 from app_private.liveops_content_receipts r where r.content_id=e.aggregate_id
    and r.state='PUBLISHED' and r.outbox_id=e.id
    and not exists(select 1 from app_private.liveops_content_receipts newer
     where newer.content_id=r.content_id and newer.revision>r.revision)
    and ((r.kind='EVENT' and exists(select 1 from public.events v where v.id=r.content_id
      and v.published_at is not null and v.status in('SCHEDULED','LIVE','ENDED')))
     or(r.kind='NOTICE' and exists(select 1 from public.notices v where v.id=r.content_id
      and v.status='PUBLISHED' and v.published_at is not null and(v.expires_at is null or v.expires_at>p_now))))))
 or exists(select 1 from public.outbox_events e where e.id=n.source_event_id
  and e.aggregate_type='event' and not exists(select 1 from public.events v
    where v.id=e.aggregate_id and v.published_at is not null and v.status in('SCHEDULED','LIVE','ENDED')))
 or exists(select 1 from public.outbox_events e where e.id=n.source_event_id
  and e.aggregate_type='notice' and not exists(select 1 from public.notices v
    where v.id=e.aggregate_id and v.status='PUBLISHED' and v.published_at is not null
      and(v.expires_at is null or v.expires_at>p_now))) then return null;end if;
 local_now:=p_now at time zone p.timezone;local_time:=local_now::time;
 if n.scheduled_at>p_now then return n.scheduled_at;end if;
 -- Digest grouping has no implemented sender here: never emit individual push
 -- while a member explicitly selected a digest mode.
 if n.category in('events','event','notices','notice','marketing') and p.digest_mode<>'OFF' then return null;end if;
 if n.category='marketing' then
  select count(distinct x.notification_id) into daily_count
   from app_private.notification_device_deliveries x join public.notifications y on y.id=x.notification_id
   where x.user_id=d.user_id and y.category='marketing' and x.notification_id<>n.id
    and ((x.status='ACCEPTED' and(x.accepted_at at time zone p.timezone)::date=local_now::date)
      or(x.status='LEASED' and x.lease_expires_at>p_now));
  if p.daily_marketing_cap=0 then return null;end if;
  if daily_count>=p.daily_marketing_cap then
   return (local_now::date+interval '1 day') at time zone p.timezone;end if;
 end if;
 if n.category in('events','event','notices','notice','marketing') then
  select max(coalesce(x.accepted_at,x.updated_at)) into last_category_at
   from app_private.notification_device_deliveries x join public.notifications y on y.id=x.notification_id
   where x.user_id=d.user_id and y.category=n.category and x.notification_id<>n.id
    and(x.status='ACCEPTED' or(x.status='LEASED' and x.lease_expires_at>p_now));
  deferred_at:=last_category_at+make_interval(mins=>p.event_cooldown_minutes);
  if deferred_at>p_now then return deferred_at;end if;
 end if;
 if p.quiet_hours_start is null and p.quiet_hours_end is null then return p_now;end if;
 if p.quiet_hours_start is null or p.quiet_hours_end is null then return null;end if;
 -- Equal endpoints mean an explicit all-day quiet preference, never a send override.
 if p.quiet_hours_start=p.quiet_hours_end then return p_now+interval '1 day';end if;
 quiet:=case when p.quiet_hours_start<p.quiet_hours_end
  then local_time>=p.quiet_hours_start and local_time<p.quiet_hours_end
  else local_time>=p.quiet_hours_start or local_time<p.quiet_hours_end end;
 if not quiet then return p_now;end if;
 return ((local_now::date+p.quiet_hours_end)+case when local_time>=p.quiet_hours_end
  then interval '1 day' else interval '0 days' end) at time zone p.timezone;
end;$$;

commit;
