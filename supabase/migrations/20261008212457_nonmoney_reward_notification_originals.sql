begin;
-- Persisted in-app reward record; opt-out suppression is a sealed outcome.
-- Push acceptance and actual device presentation are separate later evidence.
create table app_private.nonmoney_reward_notification_originals(
 award_id uuid primary key references public.member_event_awards(id),
 source_event_id uuid not null unique references public.outbox_events(id),
 user_id uuid not null references auth.users(id),
 notification_id uuid unique references public.notifications(id),
 delivery_id uuid unique references public.notification_deliveries(id),
 outcome text not null check(outcome in('PERSISTED','SUPPRESSED_PREFERENCE')),
 snapshot jsonb not null,digest text not null,created_at timestamptz not null,
 check(digest=app_private.funding_engine_digest(snapshot)),
 check((outcome='PERSISTED')=(notification_id is not null and delivery_id is not null)));
alter table app_private.nonmoney_reward_notification_originals enable row level security;
alter table app_private.nonmoney_reward_notification_originals force row level security;
revoke all on app_private.nonmoney_reward_notification_originals from public,anon,authenticated,service_role;
create trigger nonmoney_notification_original_immutable before update or delete on app_private.nonmoney_reward_notification_originals for each row execute function app_private.prevent_row_mutation();
create function app_private.assert_nonmoney_notification(p_award uuid)returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.nonmoney_reward_notification_originals%rowtype;w public.member_event_awards%rowtype;n public.notifications%rowtype;d public.notification_deliveries%rowtype;
begin
 select * into r from app_private.nonmoney_reward_notification_originals where award_id=p_award;
 select * into w from public.member_event_awards where id=p_award;
 if r.award_id is null or row(r.user_id,r.source_event_id) is distinct from row(w.user_id,w.outbox_id)
 or r.digest is distinct from app_private.funding_engine_digest(r.snapshot)
 or r.snapshot is distinct from jsonb_build_object('award_id',r.award_id,'source_event_id',r.source_event_id,'user_id',r.user_id,'notification_id',r.notification_id,'delivery_id',r.delivery_id,'outcome',r.outcome,'created_at',r.created_at)
 then raise exception using errcode='55000',message='NONMONEY_NOTIFICATION_ORIGINAL_INVALID';end if;
 if r.outcome='PERSISTED' then
 select * into n from public.notifications where id=r.notification_id;select * into d from public.notification_deliveries where id=r.delivery_id;
 if row(n.user_id,n.source_event_id,n.category,n.title_ko,n.body_ko,n.route,n.deduplication_key,n.priority,n.created_at)
 is distinct from row(w.user_id,w.outbox_id,'event_rewards',w.title_ko,'달성 기록을 확인해 주세요.','/events','nonmoney-award:'||w.id::text,100::smallint,r.created_at)
 or row(d.notification_id,d.user_id,d.channel,d.status,d.attempt_count,d.sent_at,d.delivered_at)
 is distinct from row(n.id,w.user_id,'IN_APP'::public.notification_channel,'SENT'::public.notification_delivery_status,1,r.created_at,null::timestamptz)
 then raise exception using errcode='55000',message='NONMONEY_NOTIFICATION_PROJECTION_INVALID';end if;
 end if;
end;$$;
create function app_private.persist_nonmoney_award_notification(p_award uuid)returns void language plpgsql security invoker set search_path=pg_catalog as $$
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
end;$$;
create function app_private.verify_nonmoney_notification()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin perform app_private.assert_nonmoney_notification(new.award_id);return null;end;$$;
create constraint trigger nonmoney_notification_complete after insert on app_private.nonmoney_reward_notification_originals deferrable initially deferred for each row execute function app_private.verify_nonmoney_notification();
create or replace function app_private.verify_nonmoney_award_commit()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin perform app_private.assert_nonmoney_award(new.id);perform app_private.assert_nonmoney_notification(new.id);return null;end;$$;
create function app_private.guard_nonmoney_notification_projection()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare bound boolean;mutable text[]:=array[]::text[];
begin
 if tg_table_name='notifications' then bound:=exists(select 1 from app_private.nonmoney_reward_notification_originals where notification_id=old.id);mutable:=array['read_at'];
 else bound:=exists(select 1 from app_private.nonmoney_reward_notification_originals where delivery_id=old.id);end if;
 if bound and(tg_op='DELETE' or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable)then raise exception using errcode='55000',message='NONMONEY_NOTIFICATION_IMMUTABLE';end if;
 if tg_op='DELETE'then return old;end if;return new;
end;$$;
create trigger nonmoney_notification_projection_immutable before update or delete on public.notifications for each row execute function app_private.guard_nonmoney_notification_projection();
create trigger nonmoney_notification_delivery_immutable before update or delete on public.notification_deliveries for each row execute function app_private.guard_nonmoney_notification_projection();
revoke all on function app_private.assert_nonmoney_notification(uuid),app_private.persist_nonmoney_award_notification(uuid),app_private.verify_nonmoney_notification(),app_private.guard_nonmoney_notification_projection()from public,anon,authenticated,service_role;
create or replace function app_private.evaluate_nonmoney_original(p_source uuid) returns integer
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare fact jsonb;owner_id uuid;effective_at timestamptz;source_kind text;source_digest text;policy app_private.nonmoney_event_policies%rowtype;
 j app_private.event_join_originals%rowtype;event public.events%rowtype;r app_private.liveops_content_receipts%rowtype;
 award public.member_event_awards%rowtype;aid uuid;eid uuid;request_id uuid;at timestamptz;qualification jsonb;count_granted integer:=0;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 if not exists(select 1 from app_private.nonmoney_executor_configuration where singleton and local_qa_enabled
  and project_identity='putduk-mining-local-recovery-20261009-fi') then raise exception using errcode='42501',message='NONMONEY_LOCAL_QA_DISABLED';end if;
 fact:=app_private.read_nonmoney_mission_original(p_source);
 owner_id:=(fact->>'member_id')::uuid;effective_at:=(fact->>'effective_at')::timestamptz;source_kind:=fact->>'source_type';source_digest:=fact->>'source_digest';
 if not exists(select 1 from auth.users where id=owner_id and deleted_at is null and(banned_until is null or banned_until<=clock_timestamp()))
  or not exists(select 1 from public.user_profiles where user_id=owner_id)
  or exists(select 1 from public.block_rules where user_id=owner_id and scope='ACCOUNT' and starts_at<=clock_timestamp() and(ends_at is null or ends_at>clock_timestamp())) then
  raise exception using errcode='42501',message='NONMONEY_MEMBER_RESTRICTED';end if;
 for policy in select p.* from app_private.nonmoney_event_policies p where p.scope='LOCAL_QA' and p.source_type=source_kind
  and p.starts_at<=effective_at and p.ends_at>effective_at and p.created_at<=effective_at
  and p.version=(select max(newer.version) from app_private.nonmoney_event_policies newer where newer.event_id=p.event_id and newer.rule_id=p.rule_id)
 loop
  perform app_private.assert_nonmoney_policy(policy.id);
  select * into j from app_private.event_join_originals where event_id=policy.event_id and user_id=owner_id;
  if j.id is null or j.revision_id is distinct from policy.content_revision_id or j.joined_at>effective_at then continue;end if;
  perform app_private.assert_event_join(j.id);
  select * into event from public.events where id=policy.event_id for share;
  select * into r from app_private.liveops_content_receipts where id=policy.content_revision_id;
  if event.id is null or event.status not in('SCHEDULED','LIVE','ENDED') or event.published_at is null or event.published_at>effective_at
   or r.state<>'PUBLISHED' or exists(select 1 from app_private.liveops_content_receipts where content_id=policy.event_id and revision>r.revision)
   or not exists(select 1 from public.event_member_content where event_id=policy.event_id and revision_id=r.id) then continue;end if;
  perform pg_advisory_xact_lock(hashtextextended('putduk-nonmoney-claim:'||policy.event_id::text||':'||owner_id::text||':'||policy.rule_id::text,0));
  select * into award from public.member_event_awards where event_id=policy.event_id and user_id=owner_id and rule_id=policy.rule_id;
  if award.id is not null then
   perform app_private.assert_nonmoney_award(award.id);perform app_private.assert_nonmoney_notification(award.id);
   continue;
  end if;
  at:=clock_timestamp();award.id:=gen_random_uuid();aid:=gen_random_uuid();eid:=gen_random_uuid();request_id:=gen_random_uuid();
  qualification:=jsonb_build_object('policy_id',policy.id,'policy_digest',policy.digest,'approved_revision_id',policy.content_revision_id,
   'join_original_id',j.id,'join_digest',j.digest,'member_id',owner_id,'source_event_id',p_source,'source_digest',source_digest,
   'source_type',source_kind,'business_effective_at',effective_at,'scope','LOCAL_QA');
  insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
  values(aid,owner_id,'NONMONEY_EVENT_REWARD_GRANTED','event_reward',award.id::text,'승인된 로컬 비금전 미션 달성 기록',request_id,qualification,
   jsonb_build_object('scope','LOCAL_QA','policy_id',policy.id,'rule_id',policy.rule_id),at);
  insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,occurred_at,created_at)
  values(eid,'EVENT_REWARD_GRANTED.v1',1,'event_reward',award.id,owner_id,
   jsonb_build_object('award_id',award.id,'event_id',policy.event_id,'user_id',owner_id,'rule_id',policy.rule_id,'policy_id',policy.id,
    'scope','LOCAL_QA','reward_kind',policy.reward_kind,'reward_code',policy.reward_code,'audit_id',aid,'source_event_id',p_source,
    'source_digest',source_digest,'qualification_digest',app_private.funding_engine_digest(qualification)),request_id,request_id,
   'event-reward:'||policy.event_id::text||':'||owner_id::text||':'||policy.rule_id::text,at,at);
  insert into public.member_event_awards(id,event_id,user_id,rule_id,policy_id,participant_id,source_event_id,source_digest,reward_kind,reward_code,title_ko,qualification,audit_id,outbox_id,created_at)
  values(award.id,policy.event_id,owner_id,policy.rule_id,policy.id,j.participant_id,p_source,source_digest,policy.reward_kind,policy.reward_code,
   policy.title_ko,qualification,aid,eid,at);
  update public.event_participants set status='REWARDED',completed_at=coalesce(completed_at,effective_at),rewarded_at=coalesce(rewarded_at,at),updated_at=at
   where id=j.participant_id and user_id=owner_id and event_id=policy.event_id and status in('JOINED','COMPLETED','REWARDED');
  if not found then raise exception using errcode='55000',message='NONMONEY_PARTICIPANT_STATE_INVALID';end if;
  perform app_private.persist_nonmoney_award_notification(award.id);
  count_granted:=count_granted+1;
 end loop;
 return count_granted;
end;$$;

commit;
