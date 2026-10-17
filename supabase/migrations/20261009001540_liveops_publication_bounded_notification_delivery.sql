begin;
-- Approved source-bound publication completion through existing outbox and job commands.
-- Initial cohort materialization performance is not proven at product scale.
-- Existing approved MEMBERS/ALL_MEMBERS CMS publication only. No money or send.
create table app_private.liveops_publication_notification_originals (
 id uuid primary key default gen_random_uuid(),
 revision_id uuid not null references app_private.liveops_content_receipts(id),
 source_event_id uuid not null references public.outbox_events(id),
 user_id uuid not null references auth.users(id),
 outcome text not null check(outcome in('PERSISTED','SUPPRESSED_PREFERENCE','SUPPRESSED_INACTIVE')),
 notification_id uuid unique references public.notifications(id),
 delivery_id uuid unique references public.notification_deliveries(id),
 snapshot jsonb not null,digest text not null,created_at timestamptz not null,
 unique(revision_id,user_id),
 check((outcome='PERSISTED' and notification_id is not null and delivery_id is not null)
  or(outcome<>'PERSISTED' and notification_id is null and delivery_id is null))
);
alter table app_private.liveops_publication_notification_originals enable row level security;
alter table app_private.liveops_publication_notification_originals force row level security;
revoke all on app_private.liveops_publication_notification_originals from public,anon,authenticated,service_role;
create trigger liveops_notification_original_append_only before update or delete
 on app_private.liveops_publication_notification_originals for each row execute function app_private.prevent_row_mutation();

create function app_private.assert_liveops_publication_notification(p_original uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare o app_private.liveops_publication_notification_originals%rowtype;
 r app_private.liveops_content_receipts%rowtype;n public.notifications%rowtype;d public.notification_deliveries%rowtype;
begin
 select * into o from app_private.liveops_publication_notification_originals where id=p_original;
 select * into r from app_private.liveops_content_receipts where id=o.revision_id;
 if o.id is null or r.id is null or r.state<>'PUBLISHED' or r.outbox_id is distinct from o.source_event_id
  or r.snapshot->>'audience' is distinct from 'MEMBERS' or r.snapshot->>'segment' is distinct from 'ALL_MEMBERS'
  or o.digest is distinct from app_private.funding_engine_digest(o.snapshot)
  or o.snapshot->>'revision_id' is distinct from o.revision_id::text
  or o.snapshot->>'source_event_id' is distinct from o.source_event_id::text
  or o.snapshot->>'user_id' is distinct from o.user_id::text
  or o.snapshot->>'outcome' is distinct from o.outcome
  or o.snapshot->>'notification_id' is distinct from o.notification_id::text
  or o.snapshot->>'delivery_id' is distinct from o.delivery_id::text
  or (o.snapshot->>'created_at')::timestamptz is distinct from o.created_at
  then raise exception using errcode='55000',message='LIVEOPS_NOTIFICATION_ORIGINAL_MISMATCH';end if;
 perform app_private.assert_liveops_receipt(r.id);
 if o.outcome='PERSISTED' then
  select * into n from public.notifications where id=o.notification_id;
  select * into d from public.notification_deliveries where id=o.delivery_id;
  if n.id is null or d.id is null or n.user_id is distinct from o.user_id or n.source_event_id is distinct from o.source_event_id
   or (to_jsonb(n)-'read_at') is distinct from o.snapshot->'notification'
   or to_jsonb(d) is distinct from o.snapshot->'in_app_delivery'
   or n.category is distinct from (case r.kind when 'EVENT' then 'events' else 'notices' end)
   or n.body_ko is distinct from r.snapshot->>'summary' or n.route is distinct from '/events'
   or n.deduplication_key is distinct from 'liveops-publication:'||r.id::text
   or d.notification_id is distinct from n.id or d.user_id is distinct from o.user_id
   or d.channel<>'IN_APP' or d.status<>'SENT' or d.delivered_at is not null
   then raise exception using errcode='55000',message='LIVEOPS_NOTIFICATION_PROJECTION_MISMATCH';end if;
 end if;
end;$$;
revoke all on function app_private.assert_liveops_publication_notification(uuid)from public,anon,authenticated,service_role;

create function app_private.verify_liveops_publication_notification()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin perform app_private.assert_liveops_publication_notification(new.id);return null;end;$$;
revoke all on function app_private.verify_liveops_publication_notification()from public,anon,authenticated,service_role;
create constraint trigger liveops_notification_complete after insert
 on app_private.liveops_publication_notification_originals deferrable initially deferred
 for each row execute function app_private.verify_liveops_publication_notification();

create function app_private.guard_liveops_notification_projection()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare bound boolean;
begin
 if tg_table_name='notifications' then
  bound:=exists(select 1 from app_private.liveops_publication_notification_originals where notification_id=old.id);
  if bound and(tg_op='DELETE' or (to_jsonb(new)-'read_at')is distinct from(to_jsonb(old)-'read_at'))then
   raise exception using errcode='55000',message='LIVEOPS_NOTIFICATION_PROJECTION_IMMUTABLE';end if;
 else
  bound:=exists(select 1 from app_private.liveops_publication_notification_originals where delivery_id=old.id);
  if bound and(tg_op='DELETE' or to_jsonb(new)is distinct from to_jsonb(old))then
   raise exception using errcode='55000',message='LIVEOPS_NOTIFICATION_PROJECTION_IMMUTABLE';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function app_private.guard_liveops_notification_projection()from public,anon,authenticated,service_role;
create trigger liveops_notification_projection_seal before update or delete on public.notifications
 for each row execute function app_private.guard_liveops_notification_projection();
create trigger liveops_in_app_delivery_seal before update or delete on public.notification_deliveries
 for each row execute function app_private.guard_liveops_notification_projection();

create function app_private.fanout_liveops_notification_push(p_notification uuid)returns integer
language plpgsql security invoker set search_path=pg_catalog as $$
declare o app_private.liveops_publication_notification_originals%rowtype;n public.notifications%rowtype;new_count integer;
begin
 perform app_private.assert_push_worker_context();
 select * into o from app_private.liveops_publication_notification_originals where notification_id=p_notification and outcome='PERSISTED';
 if o.id is null then raise exception using errcode='55000',message='LIVEOPS_NOTIFICATION_ORIGINAL_REQUIRED';end if;
 perform app_private.assert_liveops_publication_notification(o.id);
 select * into n from public.notifications where id=o.notification_id;
 insert into app_private.notification_device_deliveries(notification_id,subscription_id,user_id,available_at)
 select n.id,s.id,o.user_id,n.scheduled_at from public.push_subscriptions s
 join public.notification_preferences p on p.user_id=s.user_id
 where s.user_id=o.user_id and p.web_push_enabled and p.events_enabled
  and s.revoked_at is null and(s.expires_at is null or s.expires_at>clock_timestamp())
 on conflict(notification_id,subscription_id)do nothing;
 get diagnostics new_count=row_count;return new_count;
end;$$;
revoke all on function app_private.fanout_liveops_notification_push(uuid)from public,anon,authenticated,service_role;


-- Publication recipient identities freeze at the source intake. Notification work is bounded.
create table app_private.liveops_publication_cohort(
 revision_id uuid not null references app_private.liveops_content_receipts(id),
 user_id uuid not null references auth.users(id),primary key(revision_id,user_id));
create table app_private.liveops_fanout_job_originals(
 job_id uuid primary key references public.system_jobs(id),revision_id uuid not null references app_private.liveops_content_receipts(id),
 source_event_id uuid not null references public.outbox_events(id),after_user_id uuid,chunk_number integer not null check(chunk_number>0),
 cohort_count integer not null check(cohort_count>=0),digest text not null,
 unique(revision_id,chunk_number));
create table app_private.liveops_fanout_chunk_receipts(
 job_id uuid primary key references app_private.liveops_fanout_job_originals(job_id),
 processed_count integer not null check(processed_count between 0 and 100),last_user_id uuid,next_job_id uuid,
 snapshot jsonb not null,digest text not null,created_at timestamptz not null);
alter table app_private.liveops_publication_cohort enable row level security;
alter table app_private.liveops_publication_cohort force row level security;
alter table app_private.liveops_fanout_job_originals enable row level security;
alter table app_private.liveops_fanout_job_originals force row level security;
alter table app_private.liveops_fanout_chunk_receipts enable row level security;
alter table app_private.liveops_fanout_chunk_receipts force row level security;
revoke all on app_private.liveops_publication_cohort,app_private.liveops_fanout_job_originals,app_private.liveops_fanout_chunk_receipts from public,anon,authenticated,service_role;
create trigger liveops_cohort_append_only before update or delete on app_private.liveops_publication_cohort for each row execute function app_private.prevent_row_mutation();
create trigger liveops_fanout_job_original_append_only before update or delete on app_private.liveops_fanout_job_originals for each row execute function app_private.prevent_row_mutation();
create trigger liveops_fanout_chunk_append_only before update or delete on app_private.liveops_fanout_chunk_receipts for each row execute function app_private.prevent_row_mutation();
create function app_private.consume_liveops_publication(p_event_id uuid,p_worker_id text)returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;r app_private.liveops_content_receipts%rowtype;j app_private.liveops_fanout_job_originals%rowtype;
at timestamptz:=clock_timestamp();payload jsonb;frozen_count integer;
begin
 perform app_private.assert_push_worker_context();
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
 select * into e from public.outbox_events where id=p_event_id for update;
 if e.id is null or e.status<>'PROCESSING' or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null or e.lease_expires_at<at then
  raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 if e.event_type is distinct from 'LIVEOPS_CONTENT_CHANGED.v1' or e.schema_version<>1 or e.aggregate_type<>'liveops_content' then
  raise exception using errcode='55000',message='LIVEOPS_PUBLICATION_SOURCE_REQUIRED';end if;
 select * into r from app_private.liveops_content_receipts where outbox_id=e.id;
 perform app_private.assert_liveops_receipt(r.id);
 if r.state<>'PUBLISHED' then return;end if;
 if r.snapshot->>'audience' is distinct from 'MEMBERS' or r.snapshot->>'segment' is distinct from 'ALL_MEMBERS' then
  raise exception using errcode='55000',message='LIVEOPS_AUDIENCE_NOT_SUPPORTED';end if;
 if exists(select 1 from app_private.liveops_content_receipts where content_id=r.content_id and revision>r.revision)
  or(r.kind='EVENT'and not exists(select 1 from public.events where id=r.content_id and published_at is not null and status in('SCHEDULED','LIVE')and ends_at>at))
  or(r.kind='NOTICE'and not exists(select 1 from public.notices where id=r.content_id and status='PUBLISHED'and(expires_at is null or expires_at>at)))then return;end if;
 select * into j from app_private.liveops_fanout_job_originals where revision_id=r.id and chunk_number=1;
 if j.job_id is not null then
  if j.source_event_id is distinct from e.id or j.digest is distinct from app_private.funding_engine_digest(to_jsonb(j)-'digest')then
   raise exception using errcode='55000',message='LIVEOPS_FANOUT_JOB_ORIGINAL_INVALID';end if;
  perform app_private.assert_liveops_fanout_job(j.job_id);return;end if;
 insert into app_private.liveops_publication_cohort(revision_id,user_id)
 select r.id,p.user_id from public.user_profiles p join auth.users u on u.id=p.user_id where p.created_at<=r.created_at and u.created_at<=r.created_at;
 get diagnostics frozen_count=row_count;
 j.job_id:=gen_random_uuid();j.revision_id:=r.id;j.source_event_id:=e.id;j.after_user_id:=null;j.chunk_number:=1;j.cohort_count:=frozen_count;
 j.digest:=app_private.funding_engine_digest(to_jsonb(j)-'digest');
 payload:=jsonb_build_object('revision_id',j.revision_id,'source_event_id',j.source_event_id,'chunk_number',1,'after_user_id',null);
 insert into public.system_jobs(id,job_type,idempotency_key,payload,payload_version,available_at)
 values(j.job_id,'LIVEOPS_PUBLICATION_FANOUT_V1','liveops-fanout:'||r.id::text||':1',payload,1,at);
 insert into app_private.liveops_fanout_job_originals select j.*;
 -- Source intake is durably queued, not claimed as all-recipient notification delivery.
 insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
 values(e.id,'liveops_publication_enqueue.v1','SUCCEEDED',1,at)on conflict(event_id,consumer_name)do nothing;
end;$$;
revoke all on function app_private.consume_liveops_publication(uuid,text)from public,anon,authenticated,service_role;
grant execute on function app_private.consume_liveops_publication(uuid,text)to service_role;
create function app_private.process_liveops_fanout_job(p_job_id uuid,p_worker_id text)returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare job public.system_jobs%rowtype;j app_private.liveops_fanout_job_originals%rowtype;
next_j app_private.liveops_fanout_job_originals%rowtype;r app_private.liveops_content_receipts%rowtype;
o app_private.liveops_publication_notification_originals%rowtype;recipient record;n public.notifications%rowtype;d public.notification_deliveries%rowtype;
at timestamptz:=clock_timestamp();expiry timestamptz;scheduled timestamptz;category text;created_count integer:=0;suppressed_count integer:=0;
processed integer:=0;last_user uuid;next_id uuid;receipt jsonb;payload jsonb;current_source boolean;
begin
 perform app_private.assert_push_worker_context();
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
 select * into job from public.system_jobs where id=p_job_id for update;
 select * into j from app_private.liveops_fanout_job_originals where job_id=p_job_id;
 if job.id is null or j.job_id is null or job.job_type is distinct from 'LIVEOPS_PUBLICATION_FANOUT_V1' or job.payload_version<>1
  or job.idempotency_key is distinct from 'liveops-fanout:'||j.revision_id::text||':'||j.chunk_number::text
  or job.payload is distinct from jsonb_build_object('revision_id',j.revision_id,'source_event_id',j.source_event_id,'chunk_number',j.chunk_number,'after_user_id',j.after_user_id)
  or j.digest is distinct from app_private.funding_engine_digest(to_jsonb(j)-'digest')
  or j.cohort_count<>(select count(*)from app_private.liveops_publication_cohort where revision_id=j.revision_id)then
  raise exception using errcode='55000',message='LIVEOPS_FANOUT_JOB_ORIGINAL_INVALID';end if;
 select * into r from app_private.liveops_content_receipts where id=j.revision_id;
 perform app_private.assert_liveops_receipt(r.id);
 if r.state<>'PUBLISHED' or r.outbox_id is distinct from j.source_event_id then raise exception using errcode='55000',message='LIVEOPS_PUBLICATION_SOURCE_REQUIRED';end if;
 if exists(select 1 from app_private.liveops_fanout_chunk_receipts where job_id=job.id) then
  perform app_private.assert_liveops_fanout_chunk(job.id);
  if job.status='SUCCEEDED' then return;end if;
  if job.status<>'RUNNING' or job.lease_owner is distinct from p_worker_id or job.lease_expires_at is null or job.lease_expires_at<clock_timestamp()
   or not exists(select 1 from public.system_job_attempts where job_id=job.id and attempt_number=job.attempts and worker_id=p_worker_id and status='RUNNING')then
   raise exception using errcode='55000',message='JOB_LEASE_NOT_OWNED';end if;
  update public.system_jobs set status='SUCCEEDED',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error_code=null where id=job.id;
  update public.system_job_attempts set status='SUCCEEDED',completed_at=clock_timestamp() where job_id=job.id and attempt_number=job.attempts;
  return;
 end if;
 if job.status<>'RUNNING' or job.lease_owner is distinct from p_worker_id or job.lease_expires_at is null or job.lease_expires_at<at
  or not exists(select 1 from public.system_job_attempts a where a.job_id=job.id and a.attempt_number=job.attempts and a.worker_id=p_worker_id and a.status='RUNNING'and a.worker_id=p_worker_id)then
  raise exception using errcode='55000',message='JOB_LEASE_NOT_OWNED';end if;
 current_source:=not exists(select 1 from app_private.liveops_content_receipts where content_id=r.content_id and revision>r.revision)
  and((r.kind='EVENT'and exists(select 1 from public.events where id=r.content_id and published_at is not null and status in('SCHEDULED','LIVE')and ends_at>at))
   or(r.kind='NOTICE'and exists(select 1 from public.notices where id=r.content_id and status='PUBLISHED'and(expires_at is null or expires_at>at))));
 category:=case r.kind when 'EVENT' then 'events'else 'notices'end;
 expiry:=case r.kind when 'EVENT' then(r.snapshot->>'endsAt')::timestamptz else(r.snapshot->>'expiresAt')::timestamptz end;
 scheduled:=greatest(at,case r.kind when 'NOTICE'then(r.snapshot->>'publishedAt')::timestamptz else at end);
 if current_source then
 for recipient in select c.user_id,p.user_id is not null as profile_present,u.id is not null as auth_present,u.deleted_at,u.banned_until,
   exists(select 1 from public.block_rules b where b.user_id=c.user_id and b.scope='ACCOUNT'
    and b.starts_at<=at and(b.ends_at is null or b.ends_at>at))as account_blocked,
   coalesce(f.events_enabled,false)as events_enabled,to_jsonb(f)as preferences
  from app_private.liveops_publication_cohort c left join public.user_profiles p on p.user_id=c.user_id left join auth.users u on u.id=c.user_id
  left join public.notification_preferences f on f.user_id=c.user_id
  where c.revision_id=r.id and(j.after_user_id is null or c.user_id>j.after_user_id)order by c.user_id limit 100
 loop
  processed:=processed+1;last_user:=recipient.user_id;
  select * into o from app_private.liveops_publication_notification_originals where revision_id=r.id and user_id=recipient.user_id;
  if o.id is not null then perform app_private.assert_liveops_publication_notification(o.id);continue;end if;
  o.id:=gen_random_uuid();o.revision_id:=r.id;o.source_event_id:=j.source_event_id;o.user_id:=recipient.user_id;o.created_at:=at;
  o.notification_id:=null;o.delivery_id:=null;n:=null;d:=null;
  if not recipient.profile_present or not recipient.auth_present or recipient.deleted_at is not null or(recipient.banned_until is not null and recipient.banned_until>at)or recipient.account_blocked then o.outcome:='SUPPRESSED_INACTIVE';
  elsif not recipient.events_enabled then o.outcome:='SUPPRESSED_PREFERENCE';
  else
   o.outcome:='PERSISTED';o.notification_id:=gen_random_uuid();o.delivery_id:=gen_random_uuid();
   insert into public.notifications(id,user_id,category,title_ko,body_ko,route,source_event_id,deduplication_key,scheduled_at,expires_at,created_at)
   values(o.notification_id,o.user_id,category,case r.kind when 'EVENT' then '새 이벤트가 등록됐어요'else '새 공지가 등록됐어요'end,
    r.snapshot->>'summary','/events',j.source_event_id,'liveops-publication:'||r.id::text,scheduled,expiry,at)returning * into n;
   insert into public.notification_deliveries(id,notification_id,user_id,channel,status,attempt_count,sent_at,created_at)
   values(o.delivery_id,n.id,o.user_id,'IN_APP','SENT',1,at,at)returning * into d;
  end if;
  o.snapshot:=jsonb_build_object('revision_id',o.revision_id,'source_event_id',o.source_event_id,'user_id',o.user_id,'outcome',o.outcome,
   'notification_id',o.notification_id,'delivery_id',o.delivery_id,'created_at',at,'preferences',recipient.preferences,
   'notification',case when n.id is not null then to_jsonb(n)-'read_at'else null end,'in_app_delivery',case when d.id is not null then to_jsonb(d)else null end);
  o.digest:=app_private.funding_engine_digest(o.snapshot);
  insert into app_private.liveops_publication_notification_originals select o.*;
  perform app_private.assert_liveops_publication_notification(o.id);
  if o.outcome='PERSISTED' then perform app_private.fanout_liveops_notification_push(o.notification_id);created_count:=created_count+1;
  else suppressed_count:=suppressed_count+1;end if;
 end loop;

 end if;
 if current_source and last_user is not null and exists(select 1 from app_private.liveops_publication_cohort where revision_id=r.id and user_id>last_user)then
  next_j.job_id:=gen_random_uuid();next_j.revision_id:=j.revision_id;next_j.source_event_id:=j.source_event_id;
  next_j.after_user_id:=last_user;next_j.chunk_number:=j.chunk_number+1;next_j.cohort_count:=j.cohort_count;
  next_j.digest:=app_private.funding_engine_digest(to_jsonb(next_j)-'digest');next_id:=next_j.job_id;
  payload:=jsonb_build_object('revision_id',next_j.revision_id,'source_event_id',next_j.source_event_id,'chunk_number',next_j.chunk_number,'after_user_id',last_user);
  insert into public.system_jobs(id,job_type,idempotency_key,payload,payload_version,available_at)
   values(next_id,'LIVEOPS_PUBLICATION_FANOUT_V1','liveops-fanout:'||r.id::text||':'||next_j.chunk_number::text,payload,1,statement_timestamp());
  insert into app_private.liveops_fanout_job_originals select next_j.*;
 end if;
 receipt:=jsonb_build_object('job_id',job.id,'revision_id',r.id,'source_event_id',j.source_event_id,'chunk_number',j.chunk_number,
 'after_user_id',j.after_user_id,'attempt',job.attempts,'worker_id',p_worker_id,'last_user_id',last_user,'processed_count',processed,'next_job_id',next_id,'source_current',current_source,'created_at',at);
 insert into app_private.liveops_fanout_chunk_receipts values(job.id,processed,last_user,next_id,receipt,app_private.funding_engine_digest(receipt),at);
 update public.system_jobs set status='SUCCEEDED',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error_code=null
 where id=job.id and status='RUNNING' and lease_owner=p_worker_id and attempts=job.attempts and lease_expires_at>=clock_timestamp();
 if not found then raise exception using errcode='55000',message='JOB_LEASE_NOT_OWNED';end if;
 update public.system_job_attempts set status='SUCCEEDED',completed_at=at where job_id=job.id and attempt_number=job.attempts;
end;$$;
revoke all on function app_private.process_liveops_fanout_job(uuid,text)from public,anon,authenticated,service_role;
grant execute on function app_private.process_liveops_fanout_job(uuid,text)to service_role;
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
  elsif v_event.event_type in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1') then
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
create or replace function public.complete_system_job(
  p_job_id uuid,
  p_worker_id text
)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_job public.system_jobs%rowtype;
  v_user uuid;
  v_attempt integer;
begin
  -- Resolve immutable identity without a row lock. Funding completion must take
  -- its member boundary before the job row, matching foreground money commands.
  select * into v_job from public.system_jobs where id = p_job_id;
  if v_job.job_type = 'FUNDING_MINING_TICK_V1' then
    select user_id into v_user from app_private.funding_engine_jobs
    where job_id = p_job_id;
    if v_user is null then
      raise exception using errcode = '55000', message = 'FUNDING_JOB_ORIGINAL_REQUIRED';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended('putduk-funding-recovery:' || v_user::text, 0));
    select * into v_job from public.system_jobs where id = p_job_id for update;
    if v_job.job_type is distinct from 'FUNDING_MINING_TICK_V1' then
      raise exception using errcode = '55000', message = 'FUNDING_JOB_ORIGINAL_MISMATCH';
    end if;
    -- Read the durable attempt after serialization, never from caller payload.
    -- The producer validates the live fence or exact accepted completion replay,
    -- and commits earned/state/posting/job/attempt success in one transaction.
    perform app_private.process_default_funding_job(p_job_id, p_worker_id, v_job.attempts);
    return;
  end if;

  if v_job.job_type = 'LIVEOPS_PUBLICATION_FANOUT_V1' then
    perform app_private.process_liveops_fanout_job(p_job_id,p_worker_id);
    return;
  end if;

  -- Preserve the existing non-funding completion behavior and signature.
  update public.system_jobs as job
  set status = 'SUCCEEDED', completed_at = statement_timestamp(),
    lease_owner = null, lease_expires_at = null, last_error_code = null
  where job.id = p_job_id and job.status = 'RUNNING'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at >= statement_timestamp()
  returning job.attempts into v_attempt;
  if v_attempt is null then
    raise exception using errcode = '55000', message = 'JOB_LEASE_NOT_OWNED';
  end if;
  update public.system_job_attempts
  set status = 'SUCCEEDED', completed_at = statement_timestamp()
  where job_id = p_job_id and attempt_number = v_attempt;
end;
$$;

revoke all on function public.complete_system_job(uuid,text) from public,anon,authenticated;
grant execute on function public.complete_system_job(uuid,text) to service_role;
comment on function public.complete_system_job(uuid,text) is
  'Canonical worker completion; sealed funding jobs dispatch to the fenced private earned producer, without amount/time arguments or automatic scheduling.';


-- Invoker validators are called only inside closed owner functions/triggers.
create function app_private.assert_liveops_fanout_job(p_job uuid)returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare j app_private.liveops_fanout_job_originals%rowtype;v public.system_jobs%rowtype;
 r app_private.liveops_content_receipts%rowtype;prior app_private.liveops_fanout_chunk_receipts%rowtype;
begin
 select * into j from app_private.liveops_fanout_job_originals where job_id=p_job;
 select * into v from public.system_jobs where id=p_job;
 select * into r from app_private.liveops_content_receipts where id=j.revision_id;
 if j.job_id is null or v.id is null or r.id is null or r.state<>'PUBLISHED' or r.outbox_id is distinct from j.source_event_id
  or j.digest is distinct from app_private.funding_engine_digest(to_jsonb(j)-'digest')
  or v.job_type is distinct from 'LIVEOPS_PUBLICATION_FANOUT_V1' or v.payload_version is distinct from 1
  or v.idempotency_key is distinct from 'liveops-fanout:'||j.revision_id::text||':'||j.chunk_number::text
  or v.payload is distinct from jsonb_build_object('revision_id',j.revision_id,'source_event_id',j.source_event_id,'chunk_number',j.chunk_number,'after_user_id',j.after_user_id)
  or j.cohort_count<>(select count(*) from app_private.liveops_publication_cohort where revision_id=j.revision_id)
  or r.snapshot->>'audience' is distinct from 'MEMBERS' or r.snapshot->>'segment' is distinct from 'ALL_MEMBERS'
 then raise exception using errcode='55000',message='LIVEOPS_FANOUT_JOB_ORIGINAL_INVALID';end if;
 perform app_private.assert_liveops_receipt(r.id);
 if j.chunk_number=1 then
  if j.after_user_id is not null then raise exception using errcode='55000',message='LIVEOPS_FANOUT_CURSOR_INVALID';end if;
 else
  select c.* into prior from app_private.liveops_fanout_chunk_receipts c
   join app_private.liveops_fanout_job_originals o on o.job_id=c.job_id
   where o.revision_id=j.revision_id and o.chunk_number=j.chunk_number-1;
  if prior.job_id is null or prior.next_job_id is distinct from j.job_id or prior.last_user_id is distinct from j.after_user_id
   or prior.processed_count<>100 or prior.digest is distinct from app_private.funding_engine_digest(prior.snapshot)
  then raise exception using errcode='55000',message='LIVEOPS_FANOUT_CURSOR_INVALID';end if;
 end if;
end;$$;
revoke all on function app_private.assert_liveops_fanout_job(uuid)from public,anon,authenticated,service_role;

create function app_private.assert_liveops_fanout_chunk(p_job uuid)returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare c app_private.liveops_fanout_chunk_receipts%rowtype;j app_private.liveops_fanout_job_originals%rowtype;
 n app_private.liveops_fanout_job_originals%rowtype;expected integer;last_id uuid;source_current boolean;
begin
 perform app_private.assert_liveops_fanout_job(p_job);
 select * into c from app_private.liveops_fanout_chunk_receipts where job_id=p_job;
 select * into j from app_private.liveops_fanout_job_originals where job_id=p_job;
 source_current:=(c.snapshot->>'source_current')::boolean;
 if c.job_id is null or c.digest is distinct from app_private.funding_engine_digest(c.snapshot)
  or c.snapshot->>'job_id' is distinct from c.job_id::text
  or c.snapshot->>'revision_id' is distinct from j.revision_id::text
  or c.snapshot->>'source_event_id' is distinct from j.source_event_id::text
  or (c.snapshot->>'chunk_number')::integer is distinct from j.chunk_number
  or c.snapshot->>'after_user_id' is distinct from j.after_user_id::text
  or c.snapshot->>'last_user_id' is distinct from c.last_user_id::text
  or c.snapshot->>'next_job_id' is distinct from c.next_job_id::text
  or (c.snapshot->>'processed_count')::integer is distinct from c.processed_count
  or (c.snapshot->>'created_at')::timestamptz is distinct from c.created_at
  or source_current is null
  or not exists(select 1 from public.system_job_attempts a where a.job_id=p_job
   and a.attempt_number=(c.snapshot->>'attempt')::integer and a.worker_id=c.snapshot->>'worker_id'
   and a.status='SUCCEEDED' and a.completed_at is not null)
 then raise exception using errcode='55000',message='LIVEOPS_FANOUT_CHUNK_INVALID';end if;
 if source_current then
  select count(*),(array_agg(user_id order by user_id desc))[1] into expected,last_id
   from(select user_id from app_private.liveops_publication_cohort where revision_id=j.revision_id
    and(j.after_user_id is null or user_id>j.after_user_id)order by user_id limit 100)x;
  if c.processed_count<>expected or c.last_user_id is distinct from last_id
   or (select count(*)from app_private.liveops_publication_notification_originals where revision_id=j.revision_id
    and(j.after_user_id is null or user_id>j.after_user_id)and user_id<=c.last_user_id)<>expected
  then raise exception using errcode='55000',message='LIVEOPS_FANOUT_CHUNK_INVALID';end if;
  if exists(select 1 from app_private.liveops_publication_cohort where revision_id=j.revision_id and user_id>c.last_user_id)then
   select * into n from app_private.liveops_fanout_job_originals where job_id=c.next_job_id;
   if c.processed_count<>100 or n.job_id is null or n.revision_id<>j.revision_id or n.source_event_id<>j.source_event_id
    or n.chunk_number<>j.chunk_number+1 or n.after_user_id is distinct from c.last_user_id or n.cohort_count<>j.cohort_count
   then raise exception using errcode='55000',message='LIVEOPS_FANOUT_CONTINUATION_REQUIRED';end if;
   perform app_private.assert_liveops_fanout_job(n.job_id);
  elsif c.next_job_id is not null then raise exception using errcode='55000',message='LIVEOPS_FANOUT_CONTINUATION_INVALID';end if;
 elsif c.processed_count<>0 or c.last_user_id is not null or c.next_job_id is not null then
  raise exception using errcode='55000',message='LIVEOPS_FANOUT_CANCELLED_CHUNK_INVALID';
 end if;
end;$$;
revoke all on function app_private.assert_liveops_fanout_chunk(uuid)from public,anon,authenticated,service_role;

-- Reuse the reviewed closed trigger rather than widening the definer roster.
create or replace function app_private.verify_liveops_publication_notification()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_table_name='system_jobs' then
  if new.job_type='LIVEOPS_PUBLICATION_FANOUT_V1' and new.status='SUCCEEDED' then
   perform app_private.assert_liveops_fanout_chunk(new.id);
   if not exists(select 1 from public.system_job_attempts where job_id=new.id and attempt_number=new.attempts and status='SUCCEEDED' and completed_at is not null)then
    raise exception using errcode='55000',message='LIVEOPS_FANOUT_CHUNK_INVALID';end if;
  end if;
 elsif tg_table_name='notifications' then
  if new.deduplication_key like 'liveops-publication:%' or exists(select 1 from public.outbox_events where id=new.source_event_id and event_type='LIVEOPS_CONTENT_CHANGED.v1')then
   perform app_private.assert_liveops_publication_notification((select id from app_private.liveops_publication_notification_originals where notification_id=new.id));
  end if;
 elsif tg_table_name='liveops_fanout_job_originals' then perform app_private.assert_liveops_fanout_job(new.job_id);
 elsif tg_table_name='liveops_fanout_chunk_receipts' then perform app_private.assert_liveops_fanout_chunk(new.job_id);
 else perform app_private.assert_liveops_publication_notification(new.id);end if;
 return null;
end;$$;
create constraint trigger liveops_job_terminal_complete after insert or update on public.system_jobs
 deferrable initially deferred for each row execute function app_private.verify_liveops_publication_notification();
create constraint trigger liveops_notification_insert_original after insert on public.notifications
 deferrable initially deferred for each row execute function app_private.verify_liveops_publication_notification();
create constraint trigger liveops_fanout_job_complete after insert on app_private.liveops_fanout_job_originals
 deferrable initially deferred for each row execute function app_private.verify_liveops_publication_notification();
create constraint trigger liveops_fanout_chunk_complete after insert on app_private.liveops_fanout_chunk_receipts
 deferrable initially deferred for each row execute function app_private.verify_liveops_publication_notification();

create or replace function app_private.guard_liveops_notification_projection()returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare bound boolean;mutable text[];
begin
 if tg_table_name='system_jobs' then
  bound:=exists(select 1 from app_private.liveops_fanout_job_originals where job_id=old.id);
  mutable:=array['status','attempts','available_at','started_at','completed_at','last_error_code','updated_at','lease_owner','lease_expires_at','dead_lettered_at'];
 elsif tg_table_name='system_job_attempts' then
  bound:=old.status='SUCCEEDED' and exists(select 1 from app_private.liveops_fanout_chunk_receipts where job_id=old.job_id);
  mutable:=array[]::text[];
 elsif tg_table_name='notifications' then
  bound:=exists(select 1 from app_private.liveops_publication_notification_originals where notification_id=old.id);
  mutable:=array['read_at'];
 else
  bound:=exists(select 1 from app_private.liveops_publication_notification_originals where delivery_id=old.id);
  mutable:=array[]::text[];
 end if;
 if bound and(tg_op='DELETE' or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable)then
  raise exception using errcode='55000',message='LIVEOPS_NOTIFICATION_PROJECTION_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger liveops_job_envelope_seal before update or delete on public.system_jobs
 for each row execute function app_private.guard_liveops_notification_projection();
create trigger liveops_accepted_attempt_seal before update or delete on public.system_job_attempts
 for each row execute function app_private.guard_liveops_notification_projection();

-- Own visibility policies remain authoritative; scheduled/expired notifications are additionally closed.
create policy notifications_schedule_own_restrictive on public.notifications as restrictive for all to authenticated
using(scheduled_at<=statement_timestamp() and(expires_at is null or expires_at>statement_timestamp()))
with check(scheduled_at<=statement_timestamp() and(expires_at is null or expires_at>statement_timestamp()));
commit;
