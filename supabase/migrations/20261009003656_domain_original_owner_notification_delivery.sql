-- Existing seven canonical business originals -> owned factual notifications.
-- Source review: admin proposal 099ec768; sole writer, existing push leases, no new public aliases.
-- Referral/rank/maintenance writer gaps and actual device delivery remain unproven.
-- Actual sole-writer originals reuse the closed consumer; no new economics/command aliases.
-- REFERRAL/RANK/MAINTENANCE remain unsupported until a real original exists.
create table app_private.domain_notification_originals(
 source_event_id uuid primary key references public.outbox_events(id),
 user_id uuid not null references auth.users(id),source_type text not null,
 source_digest text not null,effective_at timestamptz not null,
 notification_id uuid unique references public.notifications(id),
 delivery_id uuid unique references public.notification_deliveries(id),
 outcome text not null check(outcome in('PERSISTED','SUPPRESSED_PREFERENCE','SUPPRESSED_INACTIVE')),
 snapshot jsonb not null,digest text not null,created_at timestamptz not null,
 check(digest=app_private.funding_engine_digest(snapshot)),
 check((outcome='PERSISTED' and notification_id is not null and delivery_id is not null)
  or(outcome<>'PERSISTED' and notification_id is null and delivery_id is null)));
alter table app_private.domain_notification_originals enable row level security;
alter table app_private.domain_notification_originals force row level security;
revoke all on app_private.domain_notification_originals from public,anon,authenticated,service_role;
create trigger domain_notification_original_append_only before update or delete on app_private.domain_notification_originals
 for each row execute function app_private.prevent_row_mutation();

create function app_private.read_domain_notification_original(p_source uuid)returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;m public.money_source_movements%rowtype;t public.ledger_transactions%rowtype;
 original jsonb;
begin
 perform app_private.assert_push_worker_context();
 select * into e from public.outbox_events where id=p_source;
 if e.event_type is distinct from 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' then
  return app_private.read_nonmoney_mission_original(p_source);
 end if;
 if e.schema_version<>1 or e.aggregate_type<>'usdt_manual_deposit'
  or(select count(*)from public.money_source_movements where source_event_id=e.id
   and movement_kind='CREDIT'and origin_code='USDT_KRW_DEPOSIT')<>1 then
  raise exception using errcode='55000',message='DOMAIN_USDT_SOURCE_ORIGINAL_REQUIRED';end if;
 select * into m from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT'and origin_code='USDT_KRW_DEPOSIT';
 -- Existing immutable domain/credit/journal/wallet/audit/completed-idempotency validator.
 perform app_private.assert_money_source_credit_complete(m);
 select * into t from public.ledger_transactions where id=m.ledger_transaction_id;
 if m.user_id is null or m.effective_at is null or m.effective_at>clock_timestamp()
  or m.effective_at is distinct from t.posted_at then
  raise exception using errcode='55000',message='DOMAIN_USDT_SOURCE_OWNER_CLOCK_INVALID';end if;
 original:=jsonb_build_object('credit_movement_id',m.id,'ledger_transaction_id',t.id,'wallet_ledger_id',m.wallet_ledger_id,
  'domain_id',e.aggregate_id,'domain_kind',e.aggregate_type,'member_id',m.user_id,'effective_at',m.effective_at,
  'credit_movement',to_jsonb(m),'ledger_original',to_jsonb(t),'source_event_id',e.id,'source_type',e.event_type,
  'schema_version',e.schema_version,'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',m.user_id,'effective_at',m.effective_at,'source_event_id',e.id,
  'source_type',e.event_type,'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;
revoke all on function app_private.read_domain_notification_original(uuid)from public,anon,authenticated,service_role;

create or replace function app_private.domain_notification_copy(p_type text)returns jsonb
language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 return case p_type
 when 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' then jsonb_build_object('category','wallet','title','수동 입금이 확인됐어요','body','지갑에서 입금 내역을 확인해 주세요.','route','/wallet')
 when 'DEPOSIT_CONFIRMED.v1' then jsonb_build_object('category','wallet','title','입금이 확인됐어요','body','지갑에서 입금 내역을 확인해 주세요.','route','/wallet')
 when 'WITHDRAWAL_COMPLETED.v1' then jsonb_build_object('category','wallet','title','출금이 완료됐어요','body','지갑에서 출금 내역을 확인해 주세요.','route','/wallet')
 when 'TRIAL_REWARD_CONVERTED.v1' then jsonb_build_object('category','wallet','title','체험 보상이 전환됐어요','body','지갑에서 전환 내역을 확인해 주세요.','route','/wallet')
 when 'MINING_STARTED.v1' then jsonb_build_object('category','mining','title','채굴이 시작됐어요','body','채굴 화면에서 내 진행 상태를 확인해 주세요.','route','/mining')
 when 'MINING_SETTLEMENT_COMPLETED.v1' then jsonb_build_object('category','mining','title','채굴 결과가 반영됐어요','body','채굴 화면에서 결과를 확인해 주세요.','route','/mining')
 when 'TRIAL_COMPLETED.v1' then jsonb_build_object('category','trial','title','체험이 끝났어요','body','체험 화면에서 결과를 확인해 주세요.','route','/start')
 else null end;
end;$$;
revoke all on function app_private.domain_notification_copy(text)from public,anon,authenticated,service_role;

create or replace function app_private.assert_domain_notification(p_source uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare o app_private.domain_notification_originals%rowtype;f jsonb;c jsonb;
 n public.notifications%rowtype;d public.notification_deliveries%rowtype;
begin
 f:=app_private.read_domain_notification_original(p_source);
 select * into o from app_private.domain_notification_originals where source_event_id=p_source;
 c:=app_private.domain_notification_copy(f->>'source_type');
 if o.source_event_id is null or c is null or o.user_id is distinct from(f->>'member_id')::uuid
  or o.source_type is distinct from f->>'source_type' or o.source_digest is distinct from f->>'source_digest'
  or o.effective_at is distinct from(f->>'effective_at')::timestamptz
  or o.digest is distinct from app_private.funding_engine_digest(o.snapshot)
  or o.snapshot is distinct from jsonb_build_object('source_event_id',o.source_event_id,'user_id',o.user_id,
   'source_type',o.source_type,'source_digest',o.source_digest,'effective_at',o.effective_at,
   'notification_id',o.notification_id,'delivery_id',o.delivery_id,'outcome',o.outcome,'created_at',o.created_at,
   'preferences',o.snapshot->'preferences','active',o.snapshot->'active',
   'notification',o.snapshot->'notification','in_app_delivery',o.snapshot->'in_app_delivery') then
  raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_ORIGINAL_INVALID';end if;
 if o.outcome='SUPPRESSED_INACTIVE' and o.snapshot->'active' is distinct from 'false'::jsonb
  or o.outcome<>'SUPPRESSED_INACTIVE' and o.snapshot->'active' is distinct from 'true'::jsonb then
  raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_OUTCOME_INVALID';end if;
 if o.outcome='PERSISTED' then
  if coalesce((o.snapshot->'preferences'->>case when c->>'category'='wallet' then 'wallet_enabled' else 'mining_enabled' end)::boolean,false) is not true then
   raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_PREFERENCE_INVALID';end if;
  select * into n from public.notifications where id=o.notification_id;
  select * into d from public.notification_deliveries where id=o.delivery_id;
  if n.id is null or d.id is null or(to_jsonb(n)-'read_at')is distinct from o.snapshot->'notification'
   or to_jsonb(d)is distinct from o.snapshot->'in_app_delivery'
   or row(n.user_id,n.source_event_id,n.category,n.title_ko,n.body_ko,n.route,n.deduplication_key,n.priority,n.scheduled_at,n.created_at,n.expires_at)
    is distinct from row(o.user_id,o.source_event_id,c->>'category',c->>'title',c->>'body',c->>'route',
     'domain-original:'||o.source_event_id::text,100::smallint,o.created_at,o.created_at,null::timestamptz)
   or row(d.notification_id,d.user_id,d.channel,d.status,d.attempt_count,d.sent_at,d.delivered_at)
    is distinct from row(n.id,o.user_id,'IN_APP'::public.notification_channel,'SENT'::public.notification_delivery_status,1,o.created_at,null::timestamptz) then
   raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_PROJECTION_INVALID';end if;
 elsif o.snapshot->'notification' is distinct from 'null'::jsonb or o.snapshot->'in_app_delivery' is distinct from 'null'::jsonb then
  raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_SUPPRESSION_INVALID';
 elsif o.outcome='SUPPRESSED_PREFERENCE' and coalesce((o.snapshot->'preferences'->>case when c->>'category'='wallet' then 'wallet_enabled' else 'mining_enabled' end)::boolean,false) then
  raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_PREFERENCE_INVALID';end if;
end;$$;
revoke all on function app_private.assert_domain_notification(uuid)from public,anon,authenticated,service_role;

create or replace function app_private.persist_domain_original_notification(p_source uuid)returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare f jsonb;c jsonb;o app_private.domain_notification_originals%rowtype;
 p public.notification_preferences%rowtype;n public.notifications%rowtype;d public.notification_deliveries%rowtype;
 active boolean;at timestamptz:=clock_timestamp();
begin
 perform app_private.assert_push_worker_context();
 f:=app_private.read_domain_notification_original(p_source);c:=app_private.domain_notification_copy(f->>'source_type');
 if c is null then raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_SOURCE_UNSUPPORTED';end if;
 select * into o from app_private.domain_notification_originals where source_event_id=p_source;
 if o.source_event_id is not null then perform app_private.assert_domain_notification(p_source);return;end if;
 -- Caller may already have forced all deferred checks immediate. Build the closed
 -- source projection atomically, then validate these same seals before returning.
 set constraints public.domain_notification_namespace,public.domain_notification_delivery_complete,app_private.domain_notification_complete deferred;
 o.source_event_id:=p_source;o.user_id:=(f->>'member_id')::uuid;o.source_type:=f->>'source_type';
 o.source_digest:=f->>'source_digest';o.effective_at:=(f->>'effective_at')::timestamptz;o.created_at:=at;
 select * into p from public.notification_preferences where user_id=o.user_id for share;
 active:=exists(select 1 from auth.users where id=o.user_id and deleted_at is null and(banned_until is null or banned_until<=at))
  and exists(select 1 from public.user_profiles where user_id=o.user_id)
  and not exists(select 1 from public.block_rules where user_id=o.user_id and scope='ACCOUNT' and starts_at<=at and(ends_at is null or ends_at>at));
 if not active then o.outcome:='SUPPRESSED_INACTIVE';
 elsif not coalesce(case when c->>'category'='wallet' then p.wallet_enabled else p.mining_enabled end,false)then o.outcome:='SUPPRESSED_PREFERENCE';
 else
  o.outcome:='PERSISTED';o.notification_id:=gen_random_uuid();o.delivery_id:=gen_random_uuid();
  insert into public.notifications(id,user_id,category,title_ko,body_ko,route,source_event_id,deduplication_key,priority,scheduled_at,created_at)
  values(o.notification_id,o.user_id,c->>'category',c->>'title',c->>'body',c->>'route',p_source,'domain-original:'||p_source::text,100,at,at)returning * into n;
  insert into public.notification_deliveries(id,notification_id,user_id,channel,status,attempt_count,sent_at,created_at)
  values(o.delivery_id,o.notification_id,o.user_id,'IN_APP','SENT',1,at,at)returning * into d;
 end if;
 o.snapshot:=jsonb_build_object('source_event_id',o.source_event_id,'user_id',o.user_id,'source_type',o.source_type,
  'source_digest',o.source_digest,'effective_at',o.effective_at,'notification_id',o.notification_id,'delivery_id',o.delivery_id,
  'outcome',o.outcome,'created_at',at,'preferences',to_jsonb(p),'active',active,
  'notification',case when n.id is null then null else to_jsonb(n)-'read_at'end,'in_app_delivery',case when d.id is null then null else to_jsonb(d)end);
 o.digest:=app_private.funding_engine_digest(o.snapshot);
 insert into app_private.domain_notification_originals select o.*;
 perform app_private.assert_domain_notification(p_source);
 if o.outcome='PERSISTED' then
  insert into app_private.notification_device_deliveries(notification_id,subscription_id,user_id,available_at)
  select n.id,s.id,o.user_id,n.scheduled_at from public.push_subscriptions s
  where s.user_id=o.user_id and p.web_push_enabled and s.revoked_at is null and(s.expires_at is null or s.expires_at>at)
  on conflict(notification_id,subscription_id)do nothing;
 end if;
 set constraints public.domain_notification_namespace,public.domain_notification_delivery_complete,app_private.domain_notification_complete immediate;
end;$$;
revoke all on function app_private.persist_domain_original_notification(uuid)from public,anon,authenticated,service_role;

-- Existing two SECDEF trigger signatures remain unchanged; raw private grants stay zero.
create or replace function app_private.verify_nonmoney_notification()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare source_id uuid;
begin
 if tg_table_name='nonmoney_reward_notification_originals' then
  perform app_private.assert_nonmoney_notification(new.award_id);
 elsif tg_table_name='domain_notification_originals' then perform app_private.assert_domain_notification(new.source_event_id);
 elsif tg_table_name='notifications' then
  if new.deduplication_key like 'domain-original:%'
   or exists(select 1 from public.outbox_events e where e.id=new.source_event_id
    and e.event_type in('USDT_MANUAL_DEPOSIT_CONFIRMED.v1','DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1',
      'MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1')) then
   select source_event_id into source_id from app_private.domain_notification_originals where notification_id=new.id;
   if source_id is null then raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_ORIGINAL_REQUIRED';end if;
   perform app_private.assert_domain_notification(source_id);
  end if;
 elsif tg_table_name='notification_deliveries' then
  select o.source_event_id into source_id from app_private.domain_notification_originals o where o.delivery_id=new.id;
  if source_id is not null then perform app_private.assert_domain_notification(source_id);end if;
 else raise exception using errcode='55000',message='DOMAIN_NOTIFICATION_TRIGGER_TARGET_INVALID';end if;
 return null;
end;$$;
create constraint trigger domain_notification_complete after insert on app_private.domain_notification_originals
 deferrable initially deferred for each row execute function app_private.verify_nonmoney_notification();
create constraint trigger domain_notification_namespace after insert on public.notifications
 deferrable initially deferred for each row execute function app_private.verify_nonmoney_notification();
create constraint trigger domain_notification_delivery_complete after insert on public.notification_deliveries
 deferrable initially deferred for each row execute function app_private.verify_nonmoney_notification();

create or replace function app_private.guard_nonmoney_notification_projection()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare bound boolean;mutable text[]:=array[]::text[];
begin
 if tg_table_name='notifications' then
  bound:=exists(select 1 from app_private.nonmoney_reward_notification_originals where notification_id=old.id)
   or exists(select 1 from app_private.domain_notification_originals where notification_id=old.id);mutable:=array['read_at'];
 else
  bound:=exists(select 1 from app_private.nonmoney_reward_notification_originals where delivery_id=old.id)
   or exists(select 1 from app_private.domain_notification_originals where delivery_id=old.id);
 end if;
 if bound and(tg_op='DELETE' or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable)then
  raise exception using errcode='55000',message='NONMONEY_NOTIFICATION_IMMUTABLE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end;$$;
revoke all on function app_private.verify_nonmoney_notification(),app_private.guard_nonmoney_notification_projection()from public,anon,authenticated,service_role;
-- Existing source completion and device admission consume the same sealed owner original.
-- Mission reward qualification remains separate; manual USDT never enters it.

create or replace function app_private.consume_nonmoney_source(p_event_id uuid,p_worker_id text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;d public.event_consumer_deliveries%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_event_id for update;
 if e.status is distinct from 'PROCESSING'::public.outbox_status or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null or e.lease_expires_at<clock_timestamp() then raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 -- Validate the actual sealed business original even when no local reward policy is active.
 -- Local reward activation is separate from ordinary domain-event acknowledgement.
 perform app_private.read_domain_notification_original(e.id);
 perform app_private.persist_domain_original_notification(e.id);
 if e.event_type<>'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' and exists(select 1 from app_private.nonmoney_executor_configuration
  where singleton and local_qa_enabled
   and project_identity='putduk-mining-local-recovery-20261009-fi') then
  perform app_private.evaluate_nonmoney_original(e.id);
 end if;
 insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
 values(e.id,'nonmoney_mission_original.v1','SUCCEEDED',1,clock_timestamp()) on conflict(event_id,consumer_name)do nothing;
 select * into d from public.event_consumer_deliveries where event_id=e.id and consumer_name='nonmoney_mission_original.v1';
 if d.status is distinct from 'SUCCEEDED'::public.consumer_delivery_status or d.attempt_count<>1 or d.processed_at is null or d.lease_owner is not null or d.lease_expires_at is not null or d.last_error_code is not null then raise exception using errcode='55000',message='NONMONEY_DELIVERY_INVALID';end if;
end;$$;
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
revoke all on function app_private.consume_nonmoney_source(uuid,text),app_private.push_send_available_at(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.consume_nonmoney_source(uuid,text) to service_role;
create or replace function public.complete_outbox_event(
  p_event_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_audit public.audit_logs%rowtype;
  v_key app_private.idempotency_keys%rowtype;
  v_delivery public.event_consumer_deliveries%rowtype;
begin
  if exists(select 1 from public.outbox_events where id=p_event_id and event_type='LIVEOPS_CONTENT_CHANGED.v1')then
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
  end if;
  select event.* into v_event from public.outbox_events as event
  where event.id = p_event_id for update;
  if v_event.id is null or v_event.status <> 'PROCESSING'
    or v_event.lease_owner is distinct from p_worker_id
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at < clock_timestamp() then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;

  if v_event.event_type = 'SAFE_MODE_CHANGED.v1' then
    select audit.* into v_audit from public.audit_logs as audit
    where audit.id::text = v_event.payload->>'audit_id';
    select logical_key.* into v_key from app_private.idempotency_keys as logical_key
    where logical_key.scope = 'safe_mode.control' and logical_key.actor_id is null
      and logical_key.idempotency_key = v_audit.metadata->>'idempotency_key';
    if v_event.schema_version <> 1 or v_event.aggregate_type <> 'safe_mode_control'
      or v_event.payload - array['audit_id', 'component', 'is_paused', 'review_at', 'request_hash'] <> '{}'::jsonb
      or v_audit.id is null or v_key.id is null
      or v_audit.target_type is distinct from 'SAFE_MODE'
      or v_audit.action not in ('SAFE_MODE_ENABLED', 'SAFE_MODE_DISABLED')
      or v_audit.metadata->'command_version' is distinct from '1'::jsonb
      or v_audit.actor_user_id is distinct from v_event.actor_user_id
      or v_audit.request_id is distinct from v_event.request_id
      or v_event.correlation_id is distinct from v_audit.request_id
      or v_audit.after_state->>'id' is distinct from v_event.aggregate_id::text
      or v_audit.after_state->>'component' is distinct from v_audit.target_id
      or v_event.payload->>'component' is distinct from v_audit.target_id
      or v_event.payload->'is_paused' is distinct from v_audit.after_state->'is_paused'
      or v_event.payload->'is_paused' is distinct from to_jsonb(v_audit.action = 'SAFE_MODE_ENABLED')
      or v_event.payload->'review_at' is distinct from v_audit.after_state->'review_at'
      or v_event.payload->>'request_hash' is distinct from v_audit.metadata->>'request_hash'
      or v_event.idempotency_key is distinct from 'safe-mode:' || v_key.idempotency_key
      or v_key.status <> 'COMPLETED' or v_key.completed_at is null
      or v_key.response_status is distinct from 200
      or v_key.request_hash is distinct from v_event.payload->>'request_hash'
      or v_key.response_payload->>'audit_id' is distinct from v_audit.id::text
      or v_key.response_payload->>'control_id' is distinct from v_event.aggregate_id::text
      or not exists (select 1 from public.safe_mode_controls as control
        where control.id = v_event.aggregate_id and control.component = v_audit.target_id)
      or (select count(*) from public.outbox_events as original
        where original.event_type = 'SAFE_MODE_CHANGED.v1'
          and original.payload->>'audit_id' = v_audit.id::text) <> 1 then
      raise exception using errcode = '55000', message = 'SAFE_MODE_EVENT_RECEIPT_MISMATCH';
    end if;
    insert into public.event_consumer_deliveries (
      event_id, consumer_name, status, attempt_count, processed_at
    ) values (
      v_event.id, 'operator_safe_mode_audit.v1', 'SUCCEEDED', 1, statement_timestamp()
    ) on conflict (event_id, consumer_name) do nothing;
    select delivery.* into v_delivery from public.event_consumer_deliveries as delivery
    where delivery.event_id = v_event.id and delivery.consumer_name = 'operator_safe_mode_audit.v1';
    if v_delivery.status is distinct from 'SUCCEEDED' or v_delivery.processed_at is null
      or v_delivery.attempt_count <> 1 or v_delivery.lease_owner is not null
      or v_delivery.lease_expires_at is not null or v_delivery.last_error_code is not null then
      raise exception using errcode = '55000', message = 'SAFE_MODE_DELIVERY_RECEIPT_MISMATCH';
    end if;
  elsif v_event.event_type = 'LIVEOPS_CONTENT_CHANGED.v1' then
    perform app_private.consume_liveops_publication(v_event.id,p_worker_id);
  elsif v_event.event_type = 'EVENT_PARTICIPATION_JOINED.v1' then
    perform app_private.consume_event_join(v_event.id,p_worker_id);
  elsif v_event.event_type in('USDT_MANUAL_DEPOSIT_CONFIRMED.v1','DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1') then
    perform app_private.consume_nonmoney_source(v_event.id,p_worker_id);
   else raise exception using errcode='55000',message='OUTBOX_HANDLER_UNSUPPORTED';
   end if;

  update public.outbox_events set status = 'PROCESSED',
    processed_at = statement_timestamp(), lease_owner = null,
    lease_expires_at = null, last_error_code = null where id = v_event.id
    and status = 'PROCESSING' and lease_owner = p_worker_id
    and lease_expires_at >= clock_timestamp();
  if not found then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;
end;
$$;
