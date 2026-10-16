begin;
-- Owner-reviewed Local recovery implementation. No external send/device-display evidence.
-- Private schema proposal, not a registered migration or a new public RPC alias.
-- Finance owns canonical outbox processor and claim/finalize command registration.

create table app_private.notification_device_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id),
 user_id uuid not null references auth.users(id),
 status text not null default 'PENDING' check(status in ('PENDING','LEASED','ACCEPTED','EXPIRED','CANCELLED','RETRY','FAILED')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 12),
 available_at timestamptz not null default clock_timestamp(),lease_owner text,lease_token uuid,lease_expires_at timestamptz,
 http_status integer check(http_status between 100 and 599),error_code text check(error_code ~ '^[A-Z_]{1,80}$'),
 accepted_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(notification_id,subscription_id),
 check((lease_owner is null)=(lease_token is null) and (lease_owner is null)=(lease_expires_at is null)),
 check((status='LEASED')=(lease_token is not null)),
 check((status='ACCEPTED')=(accepted_at is not null))
);
alter table app_private.notification_device_deliveries enable row level security;
alter table app_private.notification_device_deliveries force row level security;
revoke all on app_private.notification_device_deliveries from public,anon,authenticated,service_role;
create index notification_device_deliveries_ready on app_private.notification_device_deliveries(available_at,id)
 where status in ('PENDING','RETRY','LEASED');
create table app_private.notification_device_receipts (
 id uuid primary key default gen_random_uuid(),delivery_id uuid not null references app_private.notification_device_deliveries(id),
 attempt integer not null check(attempt between 1 and 12),lease_token uuid not null,
 result text not null check(result in ('ACCEPTED','EXPIRED','RETRY','REJECTED','ABORTED','UNKNOWN')),
 http_status integer check(http_status between 100 and 599),error_code text check(error_code ~ '^[A-Z_]{1,80}$'),
 occurred_at timestamptz not null default clock_timestamp(),unique(delivery_id,attempt),unique(delivery_id,lease_token)
);
alter table app_private.notification_device_receipts enable row level security;
alter table app_private.notification_device_receipts force row level security;
revoke all on app_private.notification_device_receipts from public,anon,authenticated,service_role;
create trigger notification_device_receipts_append_only before update or delete on app_private.notification_device_receipts
 for each row execute function app_private.prevent_row_mutation();
-- No grants are restored here; expose through existing canonical private outbox
-- dispatcher after finance validates actual SQL/JWT service-role proof.
-- In one producer transaction: create own-user notification + versioned outbox.
-- Fanout once per active owned subscription; preference/category consent and quiet
-- hours (timezone) checked on creation AND again before each leased send.
-- Each claim obtains FOR UPDATE SKIP LOCKED, fresh lease_token/short expiry.
-- Finalize must match id+token+owner+unexpired lease, never finalize by delivery id alone.
-- 201/202 = ACCEPTED transport only; no DELIVERED or wallet readback from acceptance.
-- 404/410 expire this exact subscription owned by this exact recipient only.
-- Cancel on notification expiry, content cancellation/archive, revoked subscription,
-- changed user ownership, preferences disabled; suppress retries after accepted.
-- Lease expiry permits bounded retry, each device has an independent attempt counter.
-- HTTP timeout/UNKNOWN keeps uncertain evidence; stable notification UUID tag on SW
-- coalesces retries but is not a proof of exactly-once visible delivery.

-- SOURCE PROPOSAL ONLY. Finance reviews/registers/applies against the actual schema.
-- Depends on pwa-device-delivery-recovery.sql; not a direct DB invocation script.

alter table app_private.notification_device_deliveries add column subscription_digest text;
alter table app_private.notification_device_receipts add column worker_id text not null;

create function app_private.assert_push_worker_context() returns void
language plpgsql security invoker set search_path=pg_catalog as $$begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role'
  or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='PUSH_CLOSED_EXECUTOR_REQUIRED';end if;
end;$$;

create function app_private.push_subscription_digest(p_subscription uuid) returns text
language sql stable security invoker set search_path=pg_catalog as $$
 select app_private.funding_engine_digest(jsonb_build_object('id',id,'user_id',user_id,
 'endpoint',endpoint,'p256dh',p256dh,'auth_secret',auth_secret,'expires_at',expires_at,'revoked_at',revoked_at))
 from public.push_subscriptions where id=p_subscription;
$$;

-- NULL means current permission is absent. A future timestamp means defer.
-- No implicit critical/marketing override. Unknown categories fail closed.
create function app_private.push_send_available_at(p_delivery uuid,p_now timestamptz)
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
 if not allowed or n.category<>'event_rewards' or not exists(select 1 from app_private.nonmoney_reward_notification_originals where notification_id=n.id and source_event_id=n.source_event_id and user_id=d.user_id and outcome='PERSISTED')then return null;end if;
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
      and v.status='PUBLISHED' and v.published_at<=p_now and(v.expires_at is null or v.expires_at>p_now))))))
 or exists(select 1 from public.outbox_events e where e.id=n.source_event_id
  and e.aggregate_type='event' and not exists(select 1 from public.events v
    where v.id=e.aggregate_id and v.published_at is not null and v.status in('SCHEDULED','LIVE','ENDED')))
 or exists(select 1 from public.outbox_events e where e.id=n.source_event_id
  and e.aggregate_type='notice' and not exists(select 1 from public.notices v
    where v.id=e.aggregate_id and v.status='PUBLISHED' and v.published_at<=p_now
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

create function app_private.claim_notification_push_deliveries(
 p_worker_id text,p_batch_size integer,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d app_private.notification_device_deliveries%rowtype;n public.notifications%rowtype;
 s public.push_subscriptions%rowtype;at timestamptz:=clock_timestamp();ready timestamptz;
 result jsonb:='[]'::jsonb;token uuid;
begin
 perform app_private.assert_push_worker_context();
 if p_worker_id is null or p_worker_id!~'^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$'
  or p_batch_size is null or p_batch_size not between 1 and 100
  or p_lease_seconds is null or p_lease_seconds not between 15 and 300 then
  raise exception using errcode='22023',message='PUSH_CLAIM_INVALID';end if;
 for d in select * from app_private.notification_device_deliveries
  where(status in('PENDING','RETRY') and available_at<=at)
   or(status='LEASED' and lease_expires_at<=at)
  order by available_at,id for update skip locked limit p_batch_size
 loop
  if d.status='LEASED' then
   insert into app_private.notification_device_receipts(delivery_id,attempt,lease_token,worker_id,result,error_code,occurred_at)
   values(d.id,d.attempt_count,d.lease_token,d.lease_owner,'UNKNOWN','PUSH_LEASE_EXPIRED',at)
   on conflict(delivery_id,attempt) do nothing;
  end if;
  -- Serialize policy admission across workers for this recipient. Never wait
  -- while holding a delivery row another worker may need in reverse order.
  if not pg_try_advisory_xact_lock(hashtextextended('putduk-push-recipient:'||d.user_id::text,0)) then continue;end if;
  ready:=app_private.push_send_available_at(d.id,at);
  if ready is null or d.attempt_count>=12 then
   update app_private.notification_device_deliveries set status=case when ready is null then 'CANCELLED' else 'FAILED' end,
    error_code=case when ready is null then 'PUSH_PERMISSION_REVOKED' else 'PUSH_ATTEMPTS_EXHAUSTED' end,
    lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=at where id=d.id;
   continue;
  end if;
  if ready>at then
   update app_private.notification_device_deliveries set status='RETRY',available_at=ready,
    lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=at where id=d.id;
   continue;
  end if;
  select * into n from public.notifications where id=d.notification_id for share;
  select * into s from public.push_subscriptions where id=d.subscription_id for share;
  token:=gen_random_uuid();
  update app_private.notification_device_deliveries set status='LEASED',attempt_count=attempt_count+1,
   lease_owner=p_worker_id,lease_token=token,lease_expires_at=at+make_interval(secs=>p_lease_seconds),
   subscription_digest=app_private.push_subscription_digest(s.id),http_status=null,error_code=null,updated_at=at
   where id=d.id returning * into d;
  -- Endpoints and key material are returned only to this service command; no logs.
  -- Privacy: generic push copy; authenticated in-app notification remains full record.
  result:=result||jsonb_build_array(jsonb_build_object('deliveryId',d.id,'notificationId',n.id,
   'workerId',p_worker_id,'leaseToken',token,'attempt',d.attempt_count,'leaseExpiresAt',d.lease_expires_at,
   'subscription',jsonb_build_object('endpoint',s.endpoint,'p256dh',s.p256dh,'authSecret',s.auth_secret),
   'payload',jsonb_build_object('notificationId',n.id,'title','퍼뜩','body','새 알림을 확인해 주세요.','route','/notifications')));
 end loop;
 return result;
end;$$;

create function app_private.settle_notification_push_delivery(
 p_delivery_id uuid,p_worker_id text,p_lease_token uuid,p_attempt integer,
 p_status text,p_http_status integer,p_error_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d app_private.notification_device_deliveries%rowtype;r app_private.notification_device_receipts%rowtype;
 at timestamptz:=clock_timestamp();ready timestamptz;final text;delay_seconds integer;
begin
 perform app_private.assert_push_worker_context();
 if p_delivery_id is null or p_lease_token is null or p_worker_id is null
  or p_worker_id!~'^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$' or p_attempt is null or p_attempt not between 1 and 12
  or p_status is null or p_status not in('ACCEPTED','EXPIRED','RETRY','REJECTED','ABORTED','UNKNOWN')
  or(p_error_code is not null and p_error_code!~'^[A-Z_]{1,80}$')
  or(p_http_status is not null and p_http_status not between 100 and 599)
  or(p_status='ACCEPTED' and(p_http_status is null or p_http_status not in(201,202) or p_error_code is not null))
  or(p_status='EXPIRED' and(p_http_status is null or p_http_status not in(404,410)))
  or(p_status='REJECTED' and(p_http_status is null or p_http_status>=500 or p_http_status in(201,202,404,410,408,429)))
  or(p_status='RETRY' and(p_http_status is null or not(p_http_status in(408,429) or p_http_status>=500)))
  or(p_status in('ABORTED','UNKNOWN') and p_http_status is not null) then
  raise exception using errcode='22023',message='PUSH_SETTLEMENT_INVALID';end if;
 select * into d from app_private.notification_device_deliveries where id=p_delivery_id for update;
 select * into r from app_private.notification_device_receipts where delivery_id=p_delivery_id and attempt=p_attempt;
 if r.id is not null then
  if row(r.lease_token,r.worker_id,r.result,r.http_status,r.error_code)
    is distinct from row(p_lease_token,p_worker_id,p_status,p_http_status,p_error_code) then
   raise exception using errcode='55000',message='PUSH_RECEIPT_CONFLICT';end if;
  return jsonb_build_object('deliveryId',d.id,'status',d.status,'replayed',true);
 end if;
 if d.id is null or d.status<>'LEASED' or d.lease_owner is distinct from p_worker_id
  or d.lease_token is distinct from p_lease_token or d.attempt_count is distinct from p_attempt
  or d.lease_expires_at<=at then raise exception using errcode='55000',message='PUSH_LEASE_STALE';end if;
 ready:=app_private.push_send_available_at(d.id,at);
 insert into app_private.notification_device_receipts(delivery_id,attempt,lease_token,worker_id,result,http_status,error_code,occurred_at)
 values(d.id,p_attempt,p_lease_token,p_worker_id,p_status,p_http_status,p_error_code,at);
 if p_status='EXPIRED' then
  -- An old endpoint's 410 must never revoke a subsequently refreshed subscription.
  update public.push_subscriptions set revoked_at=at where id=d.subscription_id and user_id=d.user_id
   and revoked_at is null and app_private.push_subscription_digest(id)=d.subscription_digest;
 end if;
 final:=case when ready is null then 'CANCELLED'
  when p_status='ACCEPTED' then 'ACCEPTED' when p_status='EXPIRED' then 'EXPIRED'
  when p_status='REJECTED' or p_attempt>=12 then 'FAILED' else 'RETRY' end;
 delay_seconds:=least(3600,30*(2^(least(p_attempt-1,7)))::integer);
 update app_private.notification_device_deliveries set status=final,
  http_status=p_http_status,error_code=case when ready is null then 'PUSH_PERMISSION_REVOKED' else p_error_code end,
  accepted_at=case when final='ACCEPTED' then at else null end,
  available_at=case when final='RETRY' then greatest(at+make_interval(secs=>delay_seconds),coalesce(ready,at)) else available_at end,
  lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=at where id=d.id;
 return jsonb_build_object('deliveryId',d.id,'status',final,'replayed',false,'transportAccepted',p_status='ACCEPTED');
end;$$;

revoke all on function app_private.assert_push_worker_context(),app_private.push_subscription_digest(uuid),
 app_private.push_send_available_at(uuid,timestamptz) from public,anon,authenticated,service_role;
create function public.claim_notification_push_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer)returns jsonb language sql security invoker set search_path=pg_catalog begin atomic select app_private.claim_notification_push_deliveries(p_worker_id,p_batch_size,p_lease_seconds);end;
create function public.settle_notification_push_delivery(p_delivery_id uuid,p_worker_id text,p_lease_token uuid,p_attempt integer,p_status text,p_http_status integer,p_error_code text)returns jsonb language sql security invoker set search_path=pg_catalog begin atomic select app_private.settle_notification_push_delivery(p_delivery_id,p_worker_id,p_lease_token,p_attempt,p_status,p_http_status,p_error_code);end;
revoke all on function app_private.claim_notification_push_deliveries(text,integer,integer),app_private.settle_notification_push_delivery(uuid,text,uuid,integer,text,integer,text)from public,anon,authenticated,service_role;
grant execute on function app_private.claim_notification_push_deliveries(text,integer,integer),app_private.settle_notification_push_delivery(uuid,text,uuid,integer,text,integer,text)to service_role;
revoke all on function public.claim_notification_push_deliveries(text,integer,integer),
 public.settle_notification_push_delivery(uuid,text,uuid,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.claim_notification_push_deliveries(text,integer,integer),
 public.settle_notification_push_delivery(uuid,text,uuid,integer,text,integer,text) to service_role;


create function app_private.fanout_nonmoney_notification_push(p_notification uuid)returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.nonmoney_reward_notification_originals%rowtype;count_new integer;
begin
 perform app_private.assert_push_worker_context();
 select * into r from app_private.nonmoney_reward_notification_originals where notification_id=p_notification and outcome='PERSISTED';
 if r.award_id is null then raise exception using errcode='55000',message='PUSH_NOTIFICATION_ORIGINAL_REQUIRED';end if;
 perform app_private.assert_nonmoney_notification(r.award_id);
 insert into app_private.notification_device_deliveries(notification_id,subscription_id,user_id)
 select r.notification_id,s.id,r.user_id from public.push_subscriptions s
 join public.notification_preferences p on p.user_id=s.user_id
 where s.user_id=r.user_id and p.web_push_enabled and p.events_enabled and s.revoked_at is null and(s.expires_at is null or s.expires_at>clock_timestamp())
 on conflict(notification_id,subscription_id)do nothing;
 get diagnostics count_new=row_count;return count_new;
end;$$;
revoke all on function app_private.fanout_nonmoney_notification_push(uuid)from public,anon,authenticated,service_role;
create function app_private.guard_push_delivery_original()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='DELETE'or row(new.id,new.notification_id,new.subscription_id,new.user_id,new.created_at)is distinct from row(old.id,old.notification_id,old.subscription_id,old.user_id,old.created_at)then raise exception using errcode='55000',message='PUSH_DELIVERY_ORIGINAL_IMMUTABLE';end if;return new;
end;$$;
revoke all on function app_private.guard_push_delivery_original()from public,anon,authenticated,service_role;
create trigger push_delivery_original_immutable before update or delete on app_private.notification_device_deliveries for each row execute function app_private.guard_push_delivery_original();
create or replace function app_private.persist_nonmoney_award_notification(p_award uuid)returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare w public.member_event_awards%rowtype;r app_private.nonmoney_reward_notification_originals%rowtype;preferences public.notification_preferences%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 perform app_private.assert_nonmoney_award(p_award);
 select * into w from public.member_event_awards where id=p_award;
 select * into r from app_private.nonmoney_reward_notification_originals where award_id=p_award;
 if r.award_id is not null then perform app_private.assert_nonmoney_notification(p_award);return;end if;
 select * into preferences from public.notification_preferences where user_id=w.user_id for share;
 r.award_id:=w.id;r.source_event_id:=w.outbox_id;r.user_id:=w.user_id;r.created_at:=clock_timestamp();
 if coalesce(preferences.events_enabled,true)then
 r.notification_id:=gen_random_uuid();r.delivery_id:=gen_random_uuid();r.outcome:='PERSISTED';
 insert into public.notifications(id,user_id,category,title_ko,body_ko,route,source_event_id,deduplication_key,priority,scheduled_at,created_at)
 values(r.notification_id,w.user_id,'event_rewards',w.title_ko,'달성 기록을 확인해 주세요.','/events',w.outbox_id,'nonmoney-award:'||w.id::text,100,r.created_at,r.created_at);
 insert into public.notification_deliveries(id,notification_id,user_id,channel,status,attempt_count,sent_at,created_at)
 values(r.delivery_id,r.notification_id,w.user_id,'IN_APP','SENT',1,r.created_at,r.created_at);
 else r.outcome:='SUPPRESSED_PREFERENCE';end if;
 r.snapshot:=jsonb_build_object('award_id',r.award_id,'source_event_id',r.source_event_id,'user_id',r.user_id,'notification_id',r.notification_id,'delivery_id',r.delivery_id,'outcome',r.outcome,'created_at',r.created_at);
 r.digest:=app_private.funding_engine_digest(r.snapshot);
 insert into app_private.nonmoney_reward_notification_originals select r.*;
 perform app_private.assert_nonmoney_notification(p_award);
 if r.outcome='PERSISTED'then perform app_private.fanout_nonmoney_notification_push(r.notification_id);end if;
end;$$;

commit;
