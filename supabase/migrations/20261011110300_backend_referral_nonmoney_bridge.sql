begin;
-- Additive backend-only bridge. Original cash policies, payout writers, amounts,
-- journal entries, budgets, event envelopes and historical records stay unchanged.
-- The two existing nonmoney drafts share one predicate and differ only in reward kind.
-- Approval/evaluation remain LOCAL_QA, default disabled and private.
create or replace function app_private.read_nonmoney_mission_original(p_source uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;m public.money_source_movements%rowtype;
 w public.withdrawal_requests%rowtype;a app_private.funding_withdrawal_clock_admissions%rowtype;
 t public.ledger_transactions%rowtype;owner_id uuid;effective_at timestamptz;original jsonb;mission app_private.funded_mining_mission_originals%rowtype;trial app_private.trial_completion_originals%rowtype;cash_fact jsonb;
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
  elsif e.event_type in('MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1')then
   select * into mission from app_private.funded_mining_mission_originals where outbox_id=e.id;
   if mission.id is null then raise exception using errcode='55000',message='NONMONEY_MINING_ORIGINAL_REQUIRED';end if;
   perform app_private.assert_funded_mining_mission_original(mission.id);
   owner_id:=mission.user_id;effective_at:=mission.effective_at;
   original:=mission.snapshot||jsonb_build_object('mission_original_id',mission.id,'mission_original_digest',mission.digest);
  elsif e.event_type='TRIAL_COMPLETED.v1'then
   select * into trial from app_private.trial_completion_originals where outbox_id=e.id;
   if trial.id is null then raise exception using errcode='55000',message='NONMONEY_TRIAL_ORIGINAL_REQUIRED';end if;
   perform app_private.assert_trial_completion_original(trial.id);
   owner_id:=trial.user_id;effective_at:=trial.effective_at;
   original:=trial.snapshot||jsonb_build_object('trial_original_id',trial.id,'trial_original_digest',trial.digest);
  elsif e.event_type='REFERRAL_REWARD_PAID.v1'then
   -- The existing ID-only cash reader verifies the approved immutable policy,
   -- attribution, beneficiary, risk, funded source, claim, balanced journal,
   -- BONUS credit, budget and canonical same-transaction paid envelope.
   -- Its referral branch returns before its fallback to this reader.
   cash_fact:=app_private.read_domain_notification_original(e.id);
   owner_id:=(cash_fact->>'member_id')::uuid;
   effective_at:=(cash_fact->>'effective_at')::timestamptz;
   original:=(cash_fact->'original')||jsonb_build_object('cash_source_digest',cash_fact->>'source_digest');
 else raise exception using errcode='55000',message='NONMONEY_CANONICAL_ORIGINAL_REQUIRED';end if;
 if owner_id is null or effective_at is null or effective_at>clock_timestamp() then
  raise exception using errcode='55000',message='NONMONEY_SOURCE_OWNER_CLOCK_INVALID';end if;
 original:=original||jsonb_build_object('source_event_id',e.id,'source_type',e.event_type,'schema_version',e.schema_version,
  'source_envelope',to_jsonb(e)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']);
 return jsonb_build_object('member_id',owner_id,'effective_at',effective_at,'source_event_id',e.id,'source_type',e.event_type,
  'source_digest',app_private.funding_engine_digest(original),'original',original);
end;$$;

create or replace function app_private.approve_local_nonmoney_policy(
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
  or p_source_type not in('DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1','REFERRAL_REWARD_PAID.v1') or p_source_type is null
  or p_reward_kind not in('BADGE','PROFILE_TITLE') or p_reward_kind is null or p_reward_code is null or p_reward_code!~'^[A-Z][A-Z0-9_]{1,47}$'
  or char_length(btrim(coalesce(p_title_ko,''))) not between 1 and 80 or char_length(btrim(coalesce(p_reason,''))) not between 10 and 500
  or char_length(coalesce(p_step_up_token,'')) not between 16 and 512 then raise exception using errcode='22023',message='INVALID_NONMONEY_POLICY';end if;
 -- Referral qualification uses the existing sealed cash paid original; no new monetary producer.
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

create or replace function app_private.consume_local_cash_source(p_event uuid,p_worker text)returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare ev public.outbox_events%rowtype;m app_private.funded_mining_mission_originals%rowtype;a public.referral_attributions%rowtype;
 p app_private.local_cash_policies%rowtype;prior app_private.local_cash_originals%rowtype;q app_private.local_cash_pending%rowtype;
 review app_private.local_cash_review_originals%rowtype;u uuid;v_stage public.referral_stage;enabled boolean;cs app_private.local_cash_consents%rowtype;locked_users uuid[];
begin
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'service_role' or auth.role()is distinct from 'service_role'
 or nullif(btrim(p_worker),'')is null then raise exception using errcode='42501',message='LOCAL_CASH_CLOSED_SERVICE_REQUIRED';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='25000',message='LOCAL_CASH_READ_COMMITTED_REQUIRED';end if;
 select * into ev from public.outbox_events where id=p_event;
 if ev.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')then
 perform app_private.assert_local_cash_posting((select id from app_private.local_cash_originals where source_event_id=ev.id),true);
 elsif ev.event_type='LOCAL_CASH_REVIEW.v1'then
 select * into review from app_private.local_cash_review_originals where event_id=ev.id;
 if review.event_id is null or review.snapshot is distinct from to_jsonb(review)-array['snapshot','digest']
 or review.digest is distinct from app_private.funding_engine_digest(review.snapshot)
 or ev.schema_version<>1 or ev.aggregate_type<>'local_cash_pending' or ev.aggregate_id<>review.pending_id
 or ev.payload is distinct from jsonb_build_object('review_original_id',review.event_id,'digest',review.digest)
 or ev.causation_id is distinct from(select mm.outbox_id from app_private.local_cash_pending qq join app_private.funded_mining_mission_originals mm on mm.id=qq.source_mission_id where qq.id=review.pending_id)
 or ev.request_id is distinct from review.event_id or ev.correlation_id is distinct from review.event_id
 or ev.idempotency_key is distinct from 'local-cash-review:'||review.pending_id||':'||review.generation
 then raise exception using errcode='55000',message='LOCAL_CASH_REVIEW_ORIGINAL_INVALID';end if;
 select mm.* into m from app_private.local_cash_pending pq join app_private.funded_mining_mission_originals mm on mm.id=pq.source_mission_id where pq.id=review.pending_id;
 elsif ev.event_type='MINING_SETTLEMENT_COMPLETED.v1' then select * into m from app_private.funded_mining_mission_originals where outbox_id=ev.id;
 else raise exception using errcode='55000',message='LOCAL_CASH_SOURCE_UNSUPPORTED';end if;
 -- All involved financial members are sorted and locked BEFORE the source lease row.
 select coalesce(array_agg(distinct x order by x),'{}'::uuid[])into locked_users from unnest(array[m.user_id]||(select coalesce(array_agg(referrer_user_id),'{}'::uuid[])from public.referral_attributions where referred_user_id=m.user_id))x where x is not null;
 foreach u in array locked_users loop
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||u,0));end loop;
 lock table public.referral_attributions in share mode;
 if exists(select 1 from public.referral_attributions where referred_user_id=m.user_id and not(referrer_user_id=any(locked_users)))then
 raise exception using errcode='40001',message='LOCAL_CASH_ATTRIBUTION_CHANGED_RETRY';end if;
 select * into ev from public.outbox_events where id=p_event for update;
 if ev.status is distinct from 'PROCESSING' or ev.lease_owner is distinct from p_worker or ev.lease_expires_at is null or ev.lease_expires_at<=clock_timestamp()then
 raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 select coalesce((select c.enabled from app_private.local_cash_configuration c where c.singleton and
 c.project_identity='putduk-mining-review-r2-20261009-e-200642'),false)into enabled;
 if m.id is not null then perform app_private.assert_funded_mining_mission_original(m.id);end if;
 if enabled and ev.event_type='MINING_SETTLEMENT_COMPLETED.v1'then
 for a in select * from public.referral_attributions where referred_user_id=m.user_id loop
 perform app_private.assert_local_referral_attribution(a.id);
 select x.* into prior from app_private.local_cash_originals x join app_private.local_cash_pending y on y.id=x.pending_id where y.referral_id=a.id and y.stage='STAGE_1';
 if prior.id is null then
 select * into p from app_private.local_cash_policies where kind='REFERRAL' and starts_at<=a.attributed_at and ends_at>a.attributed_at order by starts_at desc,id desc limit 1;
 v_stage:='STAGE_1';
 else
 select pol.* into p from app_private.local_cash_policies pol join app_private.local_cash_pending pq on pq.policy_id=pol.id where pq.id=prior.pending_id;
 if m.effective_at<prior.effective_at+interval '24 hours' or m.id=(select source_mission_id from app_private.local_cash_pending where id=prior.pending_id)then continue;end if;
 v_stage:='STAGE_2';end if;
 if p.id is null then continue;end if;
 insert into app_private.local_cash_pending(policy_id,referral_id,stage,user_id,beneficiary_user_id,source_mission_id,status)
 values(p.id,a.id,v_stage,m.user_id,a.referrer_user_id,m.id,'PENDING_BUDGET')on conflict do nothing;
 end loop;
 for cs in select * from app_private.local_cash_consents where user_id=m.user_id and accepted_at<=m.effective_at loop
 select * into p from app_private.local_cash_policies where id=cs.policy_id;
 if m.effective_at<p.starts_at or m.effective_at>=p.ends_at then continue;end if;
 insert into app_private.local_cash_pending(policy_id,user_id,beneficiary_user_id,source_mission_id,status)
 values(p.id,m.user_id,m.user_id,m.id,'PENDING_BUDGET')on conflict do nothing;
 end loop;
 end if;
 if enabled and m.id is not null then
 for q in select * from app_private.local_cash_pending where source_mission_id=m.id and status<>'PAID'order by id loop
 perform app_private.post_local_cash_pending(q.id);end loop;end if;
 if ev.event_type in('REFERRAL_REWARD_PAID.v1','EVENT_REWARD_PAID.v1')then
 perform app_private.persist_domain_original_notification(ev.id);end if;
 -- Default-off consumer still verifies the sealed original and records one delivery.
 -- Enabled LOCAL_QA policies atomically grant BADGE/TITLE with this same lease.
 if ev.event_type='REFERRAL_REWARD_PAID.v1'then
 perform app_private.consume_nonmoney_source(ev.id,p_worker);end if;
 if ev.event_type='MINING_SETTLEMENT_COMPLETED.v1'then perform app_private.consume_nonmoney_source(ev.id,p_worker);end if;
 update public.outbox_events set status='PROCESSED',processed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error_code=null
 where id=ev.id and status='PROCESSING' and lease_owner=p_worker and lease_expires_at>clock_timestamp();
 if not found then raise exception using errcode='55000',message='LOCAL_CASH_SOURCE_FENCE_LOST';end if;
 if m.id is not null then for q in select * from app_private.local_cash_pending where source_mission_id=m.id and status<>'PAID'order by id loop
 perform app_private.schedule_local_cash_review(q.id);end loop;end if;
end;$$;

revoke all on function app_private.read_nonmoney_mission_original(uuid),
 app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid)
 from public,anon,authenticated,service_role;
revoke all on function app_private.consume_local_cash_source(uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.consume_local_cash_source(uuid,text) to service_role;
alter function app_private.read_nonmoney_mission_original(uuid) owner to postgres;
alter function app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid) owner to postgres;
alter function app_private.consume_local_cash_source(uuid,text) owner to postgres;
commit;
