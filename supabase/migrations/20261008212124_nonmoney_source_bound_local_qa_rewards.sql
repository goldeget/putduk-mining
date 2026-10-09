begin;
-- New implementation reviewed from same-project proposals; not recovered Cloud SQL.
-- New local proposal. Finance is the only migration registration/apply owner.
-- Canonical worker integration and source seals are required before granting.

create table app_private.nonmoney_event_policies (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id),
 content_revision_id uuid not null references app_private.liveops_content_receipts(id),
 rule_id uuid not null,version integer not null check(version>0),scope text not null check(scope in ('LOCAL_QA','PRODUCTION')),
 source_type text not null check(source_type in ('MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','REFERRAL_REWARD_PAID.v1')),
 reward_kind text not null check(reward_kind in ('BADGE','PROFILE_TITLE')),
 reward_code text not null check(reward_code~'^[A-Z][A-Z0-9_]{1,47}$'),title_ko text not null check(char_length(title_ko) between 1 and 80),
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),
 approved_by uuid not null references auth.users(id),approval_audit_id uuid not null unique references public.audit_logs(id),
 snapshot jsonb not null,digest text not null check(digest=app_private.funding_engine_digest(snapshot)),
 created_at timestamptz not null default clock_timestamp(),unique(event_id,rule_id,version)
);
alter table app_private.nonmoney_event_policies enable row level security;
alter table app_private.nonmoney_event_policies force row level security;
revoke all on app_private.nonmoney_event_policies from public,anon,authenticated,service_role;
create trigger nonmoney_policies_append_only before update or delete on app_private.nonmoney_event_policies
 for each row execute function app_private.prevent_row_mutation();

create table public.member_event_awards (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id),user_id uuid not null references auth.users(id),
 rule_id uuid not null,policy_id uuid not null references app_private.nonmoney_event_policies(id),
 participant_id uuid not null references public.event_participants(id),source_event_id uuid not null references public.outbox_events(id),
 source_digest text not null check(source_digest~'^[a-f0-9]{64}$'),
 reward_kind text not null check(reward_kind in ('BADGE','PROFILE_TITLE')),reward_code text not null,
 title_ko text not null check(char_length(title_ko) between 1 and 80),
 qualification jsonb not null check(jsonb_typeof(qualification)='object'),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 outbox_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 created_at timestamptz not null default clock_timestamp(),unique(event_id,user_id,rule_id)
);
alter table public.member_event_awards enable row level security;
alter table public.member_event_awards force row level security;
revoke all on public.member_event_awards from public,anon,authenticated,service_role;
-- Never serialize qualification/private policy/source seals to a member browser.
grant select(id,event_id,reward_kind,title_ko,created_at) on public.member_event_awards to authenticated;
create policy member_event_awards_own_read on public.member_event_awards for select to authenticated using(user_id=(select auth.uid()));
create trigger member_event_awards_append_only before update or delete on public.member_event_awards
 for each row execute function app_private.prevent_row_mutation();
-- REQUIRED owner integration: private source evaluator called by existing closed
-- complete_outbox_event handler. A public service callable "grant" alias is forbidden.
-- Verify actual canonical original business receipt + source digest; derive user from
-- original, never accept claimed user/progress. Verify current approved CMS revision,
-- operator context/audit/policy digest, joining receipt, current risk/eligibility.
-- Under per(event,user,rule) advisory lock: existing claim returns original receipt;
-- else insert award + immutable audit + EVENT_REWARD_GRANTED.v1 outbox, transition
-- participant COMPLETED and REWARDED atomically and seal entire chain deferred.
-- Notification consumer fans out from the reward original once. No wallet entry
-- or money balance writes occur for BADGE/PROFILE_TITLE.
-- LOCAL_QA scope must be denied by production executor configuration. Actual
-- PRODUCTION policy inserts require independently approved operator authority.

-- NEW local proposal, based on verified current-project finance source.
-- Only finance registers/applies/integrates it into existing closed outbox handler.
-- No public function alias; never trust an outbox-only / claimed verified source.

create function app_private.read_nonmoney_mission_original(p_source uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;m public.money_source_movements%rowtype;
 w public.withdrawal_requests%rowtype;a app_private.funding_withdrawal_clock_admissions%rowtype;
 t public.ledger_transactions%rowtype;owner_id uuid;effective_at timestamptz;original jsonb;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_source;
 if e.id is null or e.schema_version<>1 then raise exception using errcode='55000',message='NONMONEY_CANONICAL_ORIGINAL_REQUIRED';end if;
 if e.event_type in('DEPOSIT_CONFIRMED.v1','TRIAL_REWARD_CONVERTED.v1') then
  if (select count(*) from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT')<>1 then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_CREDIT_ORIGINAL_REQUIRED';end if;
  select * into m from public.money_source_movements where source_event_id=e.id and movement_kind='CREDIT';
  if (e.event_type='DEPOSIT_CONFIRMED.v1' and(e.aggregate_type<>'deposit_request' or m.origin_code<>'KRW_DEPOSIT'))
   or(e.event_type='TRIAL_REWARD_CONVERTED.v1' and(e.aggregate_type<>'trial_reward_conversion' or m.origin_code<>'WELCOME_REWARD')) then
   raise exception using errcode='55000',message='NONMONEY_SOURCE_KIND_MISMATCH';end if;
  -- This exact existing validator verifies terminal domain row, member, amounts,
  -- balanced journal, wallet, request/correlation, canonical idempotency and audit.
  perform app_private.assert_money_source_credit_complete(m);
  select * into t from public.ledger_transactions where id=m.ledger_transaction_id;
  owner_id:=m.user_id;effective_at:=m.effective_at;
  if effective_at is distinct from t.posted_at then raise exception using errcode='55000',message='NONMONEY_BUSINESS_CLOCK_MISMATCH';end if;
  original:=jsonb_build_object('credit_movement_id',m.id,'ledger_transaction_id',t.id,'wallet_ledger_id',m.wallet_ledger_id,
   'domain_id',e.aggregate_id,'domain_kind',e.aggregate_type,'member_id',owner_id,'effective_at',effective_at,
   'credit_movement',to_jsonb(m),'ledger_original',to_jsonb(t));
 elsif e.event_type='WITHDRAWAL_COMPLETED.v1' then
  if e.aggregate_type<>'withdrawal_request' then raise exception using errcode='55000',message='NONMONEY_SOURCE_KIND_MISMATCH';end if;
  select * into w from public.withdrawal_requests where id=e.aggregate_id;
  if w.id is null or w.status<>'COMPLETED' or w.finalize_ledger_transaction_id is null or w.ledger_finalized_at is null
   or e.payload->>'finalize_ledger_transaction_id' is distinct from w.finalize_ledger_transaction_id::text then
   raise exception using errcode='55000',message='NONMONEY_WITHDRAWAL_TERMINAL_REQUIRED';end if;
  if (select count(*) from app_private.funding_withdrawal_clock_admissions where withdrawal_id=w.id and phase='FINALIZE')<>1 then
   raise exception using errcode='55000',message='NONMONEY_WITHDRAWAL_CLOCK_ORIGINAL_REQUIRED';end if;
  select * into a from app_private.funding_withdrawal_clock_admissions where withdrawal_id=w.id and phase='FINALIZE';
  -- Includes real external-send receipt, balanced journal and hold provenance,
  -- immutable admission/seal, actual completed transaction receipt and outbox.
  perform app_private.assert_funding_withdrawal_clock_completion(a.id);
  select * into t from public.ledger_transactions where id=w.finalize_ledger_transaction_id;
  owner_id:=a.user_id;effective_at:=a.effective_at;
  if owner_id is distinct from w.user_id or e.occurred_at is distinct from effective_at or e.created_at is distinct from effective_at
   or t.posted_at is distinct from effective_at or e.request_id is distinct from t.request_id then
   raise exception using errcode='55000',message='NONMONEY_BUSINESS_CLOCK_MISMATCH';end if;
  original:=jsonb_build_object('domain_id',w.id,'domain_kind','withdrawal_request','member_id',owner_id,
   'effective_at',effective_at,'clock_admission_id',a.id,'clock_admission_digest',a.input_digest,
   'ledger_transaction_id',t.id,'clock_original',app_private.funding_withdrawal_clock_snapshot(a),'ledger_original',to_jsonb(t));
 elsif e.event_type in('MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1','REFERRAL_REWARD_PAID.v1') then
  -- Verified absent producer bridge in baseline0630 and current recovery writer.
  -- Owner must add a same-TX event from an actual sealed sole-writer receipt,
  -- then replace this branch with an exact type-specific original validator.
  raise exception using errcode='55000',message='NONMONEY_SOURCE_WRITER_NOT_CONNECTED';
 else raise exception using errcode='55000',message='NONMONEY_CANONICAL_ORIGINAL_REQUIRED';end if;
 if owner_id is null or effective_at is null or effective_at>clock_timestamp() then
  raise exception using errcode='55000',message='NONMONEY_SOURCE_OWNER_CLOCK_INVALID';end if;
 original:=original||jsonb_build_object('source_event_id',e.id,'source_type',e.event_type,'schema_version',e.schema_version,
  'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',owner_id,'effective_at',effective_at,'source_event_id',e.id,'source_type',e.event_type,
  'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;
revoke all on function app_private.read_nonmoney_mission_original(uuid) from public,anon,authenticated,service_role;
-- Called only inside owner-controlled private handler under canonical service RPC.

-- New private LOCAL_QA approval proposal. Finance is sole schema/apply owner.
-- Requires reviewed nonmoney-event-schema-recovery.sql. No public alias.

create table app_private.nonmoney_executor_configuration(
 singleton boolean primary key check(singleton),project_identity text not null,
 local_qa_enabled boolean not null,created_at timestamptz not null default clock_timestamp()
);
alter table app_private.nonmoney_executor_configuration enable row level security;
alter table app_private.nonmoney_executor_configuration force row level security;
revoke all on app_private.nonmoney_executor_configuration from public,anon,authenticated,service_role;
create trigger nonmoney_executor_configuration_immutable before update or delete on app_private.nonmoney_executor_configuration
 for each row execute function app_private.prevent_row_mutation();
-- Intentionally EMPTY. Finance may insert a LOCAL_QA fixture only after verifying
-- exact current local container/API/DB identity. Browser/GUC claims cannot enable it.

create function app_private.approve_local_nonmoney_policy(
 p_event uuid,p_revision uuid,p_rule uuid,p_version integer,p_source_type text,p_reward_kind text,p_reward_code text,p_title_ko text,
 p_actor uuid,p_admin_session uuid,p_auth_session text,p_verified_aal text,p_step_up_token text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare role public.app_role;r app_private.liveops_content_receipts%rowtype;prev app_private.liveops_content_receipts%rowtype;
 event public.events%rowtype;policy app_private.nonmoney_event_policies%rowtype;idem app_private.idempotency_keys%rowtype;
 idem_id uuid;request_id uuid:=gen_random_uuid();aid uuid:=gen_random_uuid();eid uuid:=gen_random_uuid();grant_id uuid;
 snapshot jsonb;request_hash text;at timestamptz;result jsonb;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 if not exists(select 1 from app_private.nonmoney_executor_configuration where singleton and local_qa_enabled
  and project_identity='putduk-mining-local-recovery-20261009-fi') then raise exception using errcode='42501',message='NONMONEY_LOCAL_QA_DISABLED';end if;
 role:=app_private.liveops_operator_context(p_actor,p_admin_session,p_auth_session,p_verified_aal);
 if p_event is null or p_revision is null or p_rule is null or p_version is null or p_version<1 or p_idempotency_key is null
  or p_source_type not in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1') or p_source_type is null
  or p_reward_kind not in('BADGE','PROFILE_TITLE') or p_reward_kind is null or p_reward_code is null or p_reward_code!~'^[A-Z][A-Z0-9_]{1,47}$'
  or char_length(btrim(coalesce(p_title_ko,''))) not between 1 and 80 or char_length(btrim(coalesce(p_reason,''))) not between 10 and 500
  or char_length(coalesce(p_step_up_token,'')) not between 16 and 512 then raise exception using errcode='22023',message='INVALID_NONMONEY_POLICY';end if;
 -- Missing four canonical producers stay closed until an actual sole-writer bridge is reviewed.
 perform pg_advisory_xact_lock(hashtextextended('putduk-nonmoney-policy:'||p_event::text||':'||p_rule::text,0));
 select * into r from app_private.liveops_content_receipts where id=p_revision and content_id=p_event and kind='EVENT';
 select * into prev from app_private.liveops_content_receipts where id=r.previous_revision_id;
 select * into event from public.events where id=p_event for share;
 if r.id is null or r.state<>'PUBLISHED' or prev.state<>'APPROVED' or prev.digest is distinct from r.digest
  or event.id is null or event.status not in('SCHEDULED','LIVE') or event.ends_at<=clock_timestamp()
  or not exists(select 1 from public.event_member_content where event_id=p_event and revision_id=p_revision)
  or exists(select 1 from app_private.liveops_content_receipts where content_id=p_event and revision>r.revision) then
  raise exception using errcode='42501',message='NONMONEY_CURRENT_APPROVAL_REQUIRED';end if;
 perform app_private.assert_liveops_receipt(r.id);perform app_private.assert_liveops_receipt(prev.id);
 request_hash:=app_private.funding_engine_digest(jsonb_build_object('event',p_event,'revision',p_revision,'rule',p_rule,'version',p_version,
  'source_type',p_source_type,'reward_kind',p_reward_kind,'reward_code',p_reward_code,'title_ko',btrim(p_title_ko),'actor',p_actor,
  'admin_session',p_admin_session,'auth_session',p_auth_session,'reason',btrim(p_reason),'proof_hash',encode(extensions.digest(p_step_up_token,'sha256'),'hex')));
 insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status)
 values('nonmoney.local-policy',p_actor,p_idempotency_key::text,request_hash,'PROCESSING') on conflict(scope,actor_id,idempotency_key) do nothing returning id into idem_id;
 if idem_id is null then
  select * into idem from app_private.idempotency_keys where scope='nonmoney.local-policy' and actor_id=p_actor and idempotency_key=p_idempotency_key::text for update;
  if idem.request_hash is distinct from request_hash then raise exception using errcode='22023',message='IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
  if idem.status<>'COMPLETED' then raise exception using errcode='40001',message='NONMONEY_POLICY_IN_PROGRESS';end if;
  perform app_private.assert_nonmoney_policy((idem.response_payload->>'policyId')::uuid);
  return idem.response_payload;
 end if;
 if p_version<>(select coalesce(max(version),0)+1 from app_private.nonmoney_event_policies where event_id=p_event and rule_id=p_rule) then
  raise exception using errcode='40001',message='NONMONEY_POLICY_VERSION_MISMATCH';end if;
 at:=clock_timestamp();grant_id:=app_private.consume_admin_step_up_token(p_actor,p_step_up_token,'LIVEOPS_CONTENT',request_id,p_admin_session);
 policy.id:=gen_random_uuid();snapshot:=jsonb_build_object('policy_id',policy.id,'event_id',p_event,'content_revision_id',p_revision,
  'rule_id',p_rule,'version',p_version,'scope','LOCAL_QA','source_type',p_source_type,'reward_kind',p_reward_kind,'reward_code',p_reward_code,
  'title_ko',btrim(p_title_ko),'starts_at',event.starts_at,'ends_at',event.ends_at,'approved_by',p_actor,'approved_at',at,
  'admin_session_id',p_admin_session,'auth_session_id',p_auth_session,'step_up_grant_id',grant_id,'request_id',request_id,'request_hash',request_hash);
 insert into public.audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(aid,p_actor,role,'NONMONEY_LOCAL_POLICY_APPROVED','nonmoney_event_policy',policy.id::text,btrim(p_reason),request_id,snapshot,
  jsonb_build_object('admin_session_id',p_admin_session,'step_up_grant_id',grant_id,'request_hash',request_hash),at);
 insert into app_private.nonmoney_event_policies(id,event_id,content_revision_id,rule_id,version,scope,source_type,reward_kind,reward_code,title_ko,
  starts_at,ends_at,approved_by,approval_audit_id,snapshot,digest,created_at)
 values(policy.id,p_event,p_revision,p_rule,p_version,'LOCAL_QA',p_source_type,p_reward_kind,p_reward_code,btrim(p_title_ko),event.starts_at,event.ends_at,
  p_actor,aid,snapshot,app_private.funding_engine_digest(snapshot),at) returning * into policy;
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,occurred_at,created_at)
 values(eid,'NONMONEY_POLICY_APPROVED.v1',1,'nonmoney_event_policy',policy.id,p_actor,
  jsonb_build_object('policy_id',policy.id,'audit_id',aid,'scope','LOCAL_QA','digest',policy.digest),request_id,request_id,
  'nonmoney-local-policy:'||p_actor::text||':'||p_idempotency_key::text,at,at);
 result:=jsonb_build_object('policyId',policy.id,'eventId',p_event,'revisionId',p_revision,'ruleId',p_rule,'version',p_version,'scope','LOCAL_QA',
  'digest',policy.digest,'auditId',aid,'outboxId',eid,'confirmed',true);
 perform app_private.liveops_operator_context(p_actor,p_admin_session,p_auth_session,p_verified_aal);
 update app_private.idempotency_keys set status='COMPLETED',response_status=200,response_payload=result,completed_at=clock_timestamp(),locked_until=null where id=idem_id;
 perform app_private.assert_nonmoney_policy(policy.id);
 return result;
end;$$;
revoke all on function app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid)
 from public,anon,authenticated,service_role;
-- Merge with nonmoney-private-evaluator-recovery.sql and nonmoney-award-seals-recovery.sql
-- for deferred approval / immutable envelopes / sealed replay verification.
-- Owner still needs the exact safe Korean mission condition member projection.
-- No production approval helper, activation fixture, or public grant alias supplied.

-- New reviewed-source proposal, never applied here. Finance owns registration.
-- Requires proposed policy/award schema and exact original validator.
-- Existing complete_outbox_event calls this private ID-only helper after verifying
-- its lease/attempt; no public service grant alias or client eligibility exists.

create function app_private.assert_nonmoney_policy(p_id uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare p app_private.nonmoney_event_policies%rowtype;a public.audit_logs%rowtype;o public.outbox_events%rowtype;
 g public.admin_step_up_grants%rowtype;r app_private.liveops_content_receipts%rowtype;
begin
 select * into p from app_private.nonmoney_event_policies where id=p_id;
 select * into a from public.audit_logs where id=p.approval_audit_id;
 select * into g from public.admin_step_up_grants where id=(p.snapshot->>'step_up_grant_id')::uuid;
 select * into r from app_private.liveops_content_receipts where id=p.content_revision_id;
 if p.id is null or a.id is null or p.scope<>'LOCAL_QA' or p.digest is distinct from app_private.funding_engine_digest(p.snapshot)
  or a.action<>'NONMONEY_LOCAL_POLICY_APPROVED' or a.target_type<>'nonmoney_event_policy' or a.target_id is distinct from p.id::text
  or a.actor_user_id is distinct from p.approved_by or a.actor_role not in('ADMIN','SUPER_ADMIN') or a.actor_role is null
  or a.after_state is distinct from p.snapshot or a.created_at is distinct from p.created_at
  or a.request_id::text is distinct from p.snapshot->>'request_id'
  or g.id is null or g.user_id is distinct from p.approved_by or g.command_family<>'LIVEOPS_CONTENT'
  or g.admin_session_id::text is distinct from p.snapshot->>'admin_session_id' or g.consume_request_id is distinct from a.request_id or g.consumed_at is null
  or p.snapshot->>'policy_id' is distinct from p.id::text or p.snapshot->>'event_id' is distinct from p.event_id::text
  or p.snapshot->>'content_revision_id' is distinct from p.content_revision_id::text or p.snapshot->>'rule_id' is distinct from p.rule_id::text
  or p.snapshot->>'version' is distinct from p.version::text or p.snapshot->>'source_type' is distinct from p.source_type
  or p.snapshot->>'scope' is distinct from p.scope or p.snapshot->>'reward_kind' is distinct from p.reward_kind
  or p.snapshot->>'reward_code' is distinct from p.reward_code or p.snapshot->>'title_ko' is distinct from p.title_ko
  or (p.snapshot->>'starts_at')::timestamptz is distinct from p.starts_at or (p.snapshot->>'ends_at')::timestamptz is distinct from p.ends_at
  or (p.snapshot->>'approved_at')::timestamptz is distinct from p.created_at
  or p.snapshot->>'approved_by' is distinct from p.approved_by::text
  or p.starts_at is distinct from (r.snapshot->>'startsAt')::timestamptz
   or p.ends_at is distinct from (r.snapshot->>'endsAt')::timestamptz
   or r.id is null or r.kind<>'EVENT' or r.content_id is distinct from p.event_id or r.state<>'PUBLISHED' then
  raise exception using errcode='55000',message='NONMONEY_POLICY_ORIGINAL_INVALID';end if;
 perform app_private.assert_liveops_receipt(r.id);
 if (select count(*) from public.outbox_events where event_type='NONMONEY_POLICY_APPROVED.v1' and schema_version=1
  and aggregate_type='nonmoney_event_policy' and aggregate_id=p.id)<>1 then raise exception using errcode='55000',message='NONMONEY_POLICY_OUTBOX_REQUIRED';end if;
 select * into o from public.outbox_events where event_type='NONMONEY_POLICY_APPROVED.v1' and schema_version=1 and aggregate_type='nonmoney_event_policy' and aggregate_id=p.id;
 if o.actor_user_id is distinct from p.approved_by or o.request_id is distinct from a.request_id or o.correlation_id is distinct from a.request_id
  or o.occurred_at is distinct from p.created_at or o.created_at is distinct from p.created_at
  or o.payload is distinct from jsonb_build_object('policy_id',p.id,'audit_id',a.id,'scope','LOCAL_QA','digest',p.digest)
  or not exists(select 1 from app_private.idempotency_keys k where k.scope='nonmoney.local-policy' and k.actor_id=p.approved_by
   and k.status='COMPLETED' and k.request_hash=p.snapshot->>'request_hash' and k.response_payload->>'policyId'=p.id::text
   and k.response_payload->>'digest'=p.digest and k.response_payload->>'outboxId'=o.id::text) then
  raise exception using errcode='55000',message='NONMONEY_POLICY_COMPLETION_INVALID';end if;
end;$$;
create function app_private.verify_nonmoney_policy_commit() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin perform app_private.assert_nonmoney_policy(new.id);return null;end;$$;
create constraint trigger nonmoney_policy_complete after insert on app_private.nonmoney_event_policies deferrable initially deferred
 for each row execute function app_private.verify_nonmoney_policy_commit();

create function app_private.evaluate_nonmoney_original(p_source uuid) returns integer
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
   perform app_private.assert_nonmoney_award(award.id);
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
  count_granted:=count_granted+1;
 end loop;
 return count_granted;
end;$$;
revoke all on function app_private.assert_nonmoney_policy(uuid),app_private.verify_nonmoney_policy_commit(),app_private.evaluate_nonmoney_original(uuid)
 from public,anon,authenticated,service_role;
-- Merge nonmoney-award-seals-recovery.sql for deferred award / participant /
-- envelope immutable checks. No direct GRANT shortcut is permitted.
-- Closed canonical complete_outbox_event integration must first prove the actual
-- worker lease/attempt and then call this ID-only evaluator. Delivery-state or
-- outbox-only events are never business authority. Keep unresolved source4 closed.

-- Finance-owned integration proposal: exact award chain / replay / participant seals.

create function app_private.assert_nonmoney_award(p_id uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare w public.member_event_awards%rowtype;p app_private.nonmoney_event_policies%rowtype;j app_private.event_join_originals%rowtype;
 a public.audit_logs%rowtype;o public.outbox_events%rowtype;participant public.event_participants%rowtype;fact jsonb;expected jsonb;
begin
 select * into w from public.member_event_awards where id=p_id;
 select * into p from app_private.nonmoney_event_policies where id=w.policy_id;
 select * into j from app_private.event_join_originals where participant_id=w.participant_id;
 select * into participant from public.event_participants where id=w.participant_id;
 select * into a from public.audit_logs where id=w.audit_id;select * into o from public.outbox_events where id=w.outbox_id;
 if w.id is null or p.id is null or j.id is null then raise exception using errcode='55000',message='NONMONEY_AWARD_ORIGINAL_REQUIRED';end if;
 perform app_private.assert_nonmoney_policy(p.id);perform app_private.assert_event_join(j.id);
 fact:=app_private.read_nonmoney_mission_original(w.source_event_id);
 expected:=jsonb_build_object('policy_id',p.id,'policy_digest',p.digest,'approved_revision_id',p.content_revision_id,
  'join_original_id',j.id,'join_digest',j.digest,'member_id',j.user_id,'source_event_id',w.source_event_id,'source_digest',fact->>'source_digest',
  'source_type',fact->>'source_type','business_effective_at',(fact->>'effective_at')::timestamptz,'scope','LOCAL_QA');
 if w.event_id is distinct from p.event_id or w.rule_id is distinct from p.rule_id or w.user_id is distinct from j.user_id
  or w.event_id is distinct from j.event_id or j.revision_id is distinct from p.content_revision_id
  or w.source_digest is distinct from fact->>'source_digest' or w.user_id::text is distinct from fact->>'member_id'
  or p.source_type is distinct from fact->>'source_type' or w.reward_kind is distinct from p.reward_kind or w.reward_code is distinct from p.reward_code
  or w.title_ko is distinct from p.title_ko or w.qualification is distinct from expected
  or (fact->>'effective_at')::timestamptz<greatest(j.joined_at,p.starts_at,p.created_at)
  or (fact->>'effective_at')::timestamptz>=p.ends_at or w.created_at<(fact->>'effective_at')::timestamptz
  or participant.status is distinct from 'REWARDED'::public.event_participant_status
  or participant.completed_at is null or participant.rewarded_at is null
  or participant.completed_at>(fact->>'effective_at')::timestamptz or participant.rewarded_at>w.created_at
  or a.id is null or a.action<>'NONMONEY_EVENT_REWARD_GRANTED' or a.target_type<>'event_reward' or a.target_id is distinct from w.id::text
  or a.actor_user_id is distinct from w.user_id or a.after_state is distinct from expected or a.created_at is distinct from w.created_at
  or o.id is null or o.event_type<>'EVENT_REWARD_GRANTED.v1' or o.schema_version<>1 or o.aggregate_type<>'event_reward' or o.aggregate_id is distinct from w.id
  or o.actor_user_id is distinct from w.user_id or o.request_id is distinct from a.request_id or o.correlation_id is distinct from a.request_id
  or o.idempotency_key is distinct from 'event-reward:'||w.event_id::text||':'||w.user_id::text||':'||w.rule_id::text
  or o.occurred_at is distinct from w.created_at or o.created_at is distinct from w.created_at
  or o.payload is distinct from jsonb_build_object('award_id',w.id,'event_id',w.event_id,'user_id',w.user_id,'rule_id',w.rule_id,'policy_id',p.id,
   'scope','LOCAL_QA','reward_kind',p.reward_kind,'reward_code',p.reward_code,'audit_id',a.id,'source_event_id',w.source_event_id,
   'source_digest',w.source_digest,'qualification_digest',app_private.funding_engine_digest(expected)) then
  raise exception using errcode='55000',message='NONMONEY_AWARD_CHAIN_INVALID';end if;
end;$$;
create function app_private.verify_nonmoney_award_commit() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin perform app_private.assert_nonmoney_award(new.id);return null;end;$$;
create constraint trigger nonmoney_award_complete after insert on public.member_event_awards deferrable initially deferred
 for each row execute function app_private.verify_nonmoney_award_commit();

create or replace function app_private.verify_event_participant_join() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare j uuid;p public.event_participants%rowtype;w public.member_event_awards%rowtype;
begin
 if exists(select 1 from public.event_member_content where event_id=new.event_id) then
  select id into j from app_private.event_join_originals where participant_id=new.id;
  if j is null then raise exception using errcode='55000',message='EVENT_JOIN_ORIGINAL_REQUIRED';end if;
  perform app_private.assert_event_join(j);select * into p from public.event_participants where id=new.id;
  if p.status='JOINED' and p.completed_at is null and p.rewarded_at is null then return null;end if;
  if p.status is distinct from 'REWARDED'::public.event_participant_status or p.completed_at is null or p.rewarded_at is null then
   raise exception using errcode='55000',message='EVENT_REWARD_ORIGINAL_REQUIRED';end if;
  if not exists(select 1 from public.member_event_awards where participant_id=p.id and user_id=p.user_id and event_id=p.event_id) then
   raise exception using errcode='55000',message='EVENT_REWARD_ORIGINAL_REQUIRED';end if;
  for w in select * from public.member_event_awards where participant_id=p.id loop perform app_private.assert_nonmoney_award(w.id);end loop;
 end if;return null;
end;$$;

create function app_private.guard_nonmoney_envelope() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare bound boolean:=false;mutable text[]:=array[]::text[];
begin
 if tg_table_schema='public' and tg_table_name='outbox_events' then
  bound:=exists(select 1 from public.member_event_awards where outbox_id=old.id or source_event_id=old.id)
   or exists(select 1 from app_private.nonmoney_event_policies p where to_jsonb(old)->>'aggregate_type'='nonmoney_event_policy' and to_jsonb(old)->>'aggregate_id'=p.id::text and to_jsonb(old)->>'event_type'='NONMONEY_POLICY_APPROVED.v1');
  mutable:=array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'];
 elsif tg_table_schema='public' and tg_table_name='audit_logs' then
  bound:=exists(select 1 from public.member_event_awards where audit_id=old.id) or exists(select 1 from app_private.nonmoney_event_policies where approval_audit_id=old.id);
 elsif tg_table_schema='app_private' and tg_table_name='idempotency_keys' then
   bound:=to_jsonb(old)->>'scope'='nonmoney.local-policy' and to_jsonb(old)->>'status'='COMPLETED';
 end if;
 if bound and(tg_op='DELETE' or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable) then
  raise exception using errcode='55000',message='NONMONEY_ORIGINAL_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger nonmoney_outbox_immutable before update or delete on public.outbox_events for each row execute function app_private.guard_nonmoney_envelope();
create trigger nonmoney_audit_immutable before update or delete on public.audit_logs for each row execute function app_private.guard_nonmoney_envelope();
create trigger nonmoney_idempotency_immutable before update or delete on app_private.idempotency_keys for each row execute function app_private.guard_nonmoney_envelope();
revoke all on function app_private.assert_nonmoney_award(uuid),app_private.verify_nonmoney_award_commit(),app_private.verify_event_participant_join(),app_private.guard_nonmoney_envelope()
 from public,anon,authenticated,service_role;
-- Policy approval and stable-claim evaluator proposals invoke these verifiers on replay.
-- Native transaction tests must execute deferred checks under exact service role;
-- there is no role/GUC switch inside these helpers. Closed-worker lease proof is
-- owned by existing complete_outbox_event and is not replaced by these functions.


create function app_private.consume_nonmoney_source(p_event_id uuid,p_worker_id text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;d public.event_consumer_deliveries%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_event_id for update;
 if e.status is distinct from 'PROCESSING'::public.outbox_status or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null or e.lease_expires_at<clock_timestamp() then raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 perform app_private.evaluate_nonmoney_original(e.id);
 insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
 values(e.id,'nonmoney_mission_original.v1','SUCCEEDED',1,clock_timestamp()) on conflict(event_id,consumer_name)do nothing;
 select * into d from public.event_consumer_deliveries where event_id=e.id and consumer_name='nonmoney_mission_original.v1';
 if d.status is distinct from 'SUCCEEDED'::public.consumer_delivery_status or d.attempt_count<>1 or d.processed_at is null or d.lease_owner is not null or d.lease_expires_at is not null or d.last_error_code is not null then raise exception using errcode='55000',message='NONMONEY_DELIVERY_INVALID';end if;
end;$$;
revoke all on function app_private.consume_nonmoney_source(uuid,text) from public,anon,authenticated,service_role;
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
  elsif v_event.event_type = 'EVENT_PARTICIPATION_JOINED.v1' then
    perform app_private.consume_event_join(v_event.id,p_worker_id);
  elsif v_event.event_type in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1') then
    perform app_private.consume_nonmoney_source(v_event.id,p_worker_id);
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


commit;
