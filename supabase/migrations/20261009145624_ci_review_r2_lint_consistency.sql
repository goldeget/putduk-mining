begin;
-- Forward-only lint repair. Earlier applied/reviewed migration bytes are retained.
-- CREATE OR REPLACE retains signatures, owners and ACLs; no rule, money,
-- qualification, fence, consent or service/member authorization is changed.
-- Remove two unused declarations, explicitly type the fixed JSON literal and
-- correct notification-copy volatility to match jsonb_build_object (STABLE).
create or replace function public.schedule_due_funding_jobs(
 p_batch_size integer default 25,p_after_user_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare candidate record;current_state app_private.funding_engine_state_receipts%rowtype;
 activation app_private.funding_engine_activations%rowtype;job public.system_jobs%rowtype;
 target timestamptz;policy_until timestamptz;job_id uuid;scanned integer:=0;scheduled integer:=0;
 blocked integer:=0;busy integer:=0;last_user uuid;next_cursor uuid;
begin
 if current_user<>'service_role' or current_setting('role',true) is distinct from 'service_role'
  or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED';end if;
 if p_batch_size is null or p_batch_size not between 1 and 100 then
  raise exception using errcode='22023',message='FUNDING_SCHEDULER_BATCH_INVALID';end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED';end if;
 -- Fast fail-closed observation only, taking no lock before the member lock.
 -- The canonical guard is rechecked under the member lock below.
 if exists(select 1 from public.safe_mode_controls where component in('GLOBAL','SETTLEMENT','NEW_MINING')
  and is_paused and starts_at<=clock_timestamp()) then
  return jsonb_build_object('contract_version',1,'scanned',0,'scheduled',0,'blocked',0,'busy',0,
   'paused',true,'next_cursor',null);
 end if;
 for candidate in
  select s.user_id,s.id,s.activation_id from app_private.funding_engine_state s
  join app_private.funding_engine_activations a on a.id=s.activation_id
  join app_private.funding_cycle_windows c on c.id=s.cycle_id
  where a.runtime_version=2 and not s.cycle_closed and s.cursor_at<least(clock_timestamp(),c.cycle_end)
   and (p_after_user_id is null or s.user_id>p_after_user_id)
   and not exists(select 1 from app_private.funding_engine_jobs f join public.system_jobs j on j.id=f.job_id
    where f.expected_state_id=s.id and not(j.status='PENDING' and j.attempts=0
     and j.available_at='infinity'::timestamptz and j.last_error_code='FUNDING_ENGINE_RUNTIME_NOT_CONNECTED'))
  order by s.user_id limit p_batch_size
 loop
  scanned:=scanned+1;last_user:=candidate.user_id;
  -- Different workers cannot prepare two jobs for the same state. A busy
  -- member never blocks the batch; completion uses this exact same lock.
  if not pg_try_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||candidate.user_id::text,0)) then
   busy:=busy+1;continue;end if;
  begin
   select * into current_state from app_private.funding_engine_state where user_id=candidate.user_id;
   if current_state.id is distinct from candidate.id or current_state.cycle_closed then
    blocked:=blocked+1;continue;end if;
   select * into activation from app_private.funding_engine_activations where id=current_state.activation_id;
   select effective_until into policy_until from app_private.economy_policy_published
    where publication_id=activation.policy_publication_id;
   select least(clock_timestamp(),c.cycle_end,coalesce(policy_until,'infinity'::timestamptz)) into target
    from app_private.funding_cycle_windows c where c.id=current_state.cycle_id;
   if target is null or target<=current_state.cursor_at then blocked:=blocked+1;continue;end if;
   -- Existing current-only reader verifies activation/condition seals, exact
   -- principal originals, allocation and event-time policy. No history repair.
   perform app_private.read_neutral_funding_job_inputs(activation.id,current_state.id,target);
   perform app_private.assert_funding_global_execution_allowed();
   job_id:=app_private.prepare_default_funding_job(activation.id);
   select * into job from public.system_jobs where id=job_id for update;
   if job.job_type is distinct from 'FUNDING_MINING_TICK_V1' or job.payload_version<>1
    or job.idempotency_key is distinct from 'funding:state:'||current_state.id::text
    or job.payload is distinct from jsonb_build_object('user_id',candidate.user_id,
     'activation_id',activation.id,'expected_state_id',current_state.id) then
    raise exception using errcode='55000',message='FUNDING_JOB_ORIGINAL_MISMATCH';end if;
   -- Release only the exact never-attempted dormant sealed original. Retry,
   -- running, terminal and unrelated infinity jobs are never changed here.
   update public.system_jobs set available_at=clock_timestamp(),last_error_code=null
    where id=job_id and status='PENDING' and attempts=0 and available_at='infinity'::timestamptz
     and last_error_code='FUNDING_ENGINE_RUNTIME_NOT_CONNECTED';
   if found then scheduled:=scheduled+1;end if;
  exception when sqlstate '55000' then
   -- The subtransaction also rolls back any preparation/seal on failure.
   blocked:=blocked+1;
  end;
 end loop;
 if scanned=p_batch_size then next_cursor:=last_user;end if;
 return jsonb_build_object('contract_version',1,'scanned',scanned,'scheduled',scheduled,
  'blocked',blocked,'busy',busy,'paused',false,'next_cursor',next_cursor);
end;
$$;

create or replace function app_private.read_local_cash_risk(p_users uuid[])returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare u uuid;k public.kyc_cases%rowtype;cases jsonb:='[]'::jsonb;flags jsonb;ring boolean;blocked boolean:=false;
begin
 -- Writer acquires sorted canonical member locks first. These table SHARE locks
 -- prevent phantom risk/graph/KYC decisions during the same atomic acceptance.
 lock table public.kyc_cases,public.kyc_status_history,public.risk_flags,public.referral_attributions,public.block_rules in share mode;
 perform 1 from auth.users where id=any(p_users)order by id for share;
 foreach u in array p_users loop
 select * into k from public.kyc_cases where user_id=u order by opened_at desc,id desc limit 1;
 if k.id is null or k.status<>'APPROVED' or k.decided_at is null or k.decided_at>clock_timestamp()
 or k.risk_level not in('LOW','MEDIUM') or not exists(select 1 from public.kyc_status_history h
 where h.case_id=k.id and h.to_status='APPROVED' and h.created_at<=k.decided_at and h.actor_user_id=k.reviewed_by)
 or not exists(select 1 from auth.users where id=u and deleted_at is null and(banned_until is null or banned_until<=clock_timestamp()))
 or exists(select 1 from public.block_rules where user_id=u and scope='ACCOUNT' and starts_at<=clock_timestamp()
 and(ends_at is null or ends_at>clock_timestamp()))then blocked:=true;end if;
 cases:=cases||jsonb_build_array(jsonb_build_object('user_id',u,'case_id',k.id,'status',k.status,'risk_level',k.risk_level,'decided_at',k.decided_at));
 end loop;
 select coalesce(jsonb_agg(to_jsonb(f)order by f.id),'[]')into flags from public.risk_flags f where user_id=any(p_users)
 and resolved_at is null and severity in('HIGH','CRITICAL') and flag_code<>'SHARED_IP';
 with recursive path(u,seen,depth,cycle)as(
 select v,array[v],0,false from unnest(p_users)v
 union all select r.referrer_user_id,p.seen||r.referrer_user_id,p.depth+1,r.referrer_user_id=any(p.seen)
 from path p join public.referral_attributions r on r.referred_user_id=p.u where not p.cycle and p.depth<100)
 select coalesce(bool_or(cycle or depth=100),false)into ring from path;
 return jsonb_build_object('model','NATIVE_SAME_TX_R2_V1','evaluated_at',clock_timestamp(),'kyc',cases,'blocking_flags',flags,
 'ring_or_unresolved_depth',ring,'shared_ip_alone_rejects',false,
 'decision',case when blocked or ring or jsonb_array_length(flags)>0 then 'AUTO_HOLD'else 'CLEAR'end);
end;$$;

create or replace function app_private.participate_published_event(p_event_id uuid,p_revision_id uuid,p_idempotency_key uuid,p_request_id uuid,p_cash_terms_digest text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actor uuid;p app_private.local_cash_policies%rowtype;j app_private.event_join_originals%rowtype;
 c app_private.local_cash_consents%rowtype;result jsonb;
begin
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'authenticated' or auth.role()is distinct from 'authenticated' or auth.uid()is null then
 raise exception using errcode='42501',message='LOCAL_CASH_MEMBER_REQUIRED';end if;
 actor:=auth.uid();
 if not exists(select 1 from app_private.local_cash_configuration where singleton and enabled and project_identity='putduk-mining-review-r2-20261009-e-200642')then
 raise exception using errcode='42501',message='LOCAL_CASH_DISABLED';end if;
 select cp.* into p from app_private.local_cash_policies cp join public.event_rewards rw on rw.id=cp.event_reward_id
 where rw.event_id=p_event_id and cp.content_revision_id=p_revision_id and cp.kind='EVENT' and cp.digest=p_cash_terms_digest
 and cp.starts_at<=clock_timestamp()and cp.ends_at>clock_timestamp();
 if p.id is null then raise exception using errcode='22023',message='LOCAL_CASH_EXPLICIT_TERMS_MISMATCH';end if;
 perform app_private.assert_local_cash_policy(p.id);
 result:=app_private.participate_published_event(p_event_id,p_revision_id,p_idempotency_key,p_request_id);
 select * into j from app_private.event_join_originals where event_id=p_event_id and user_id=actor;
 perform app_private.assert_event_join(j.id);
 c.policy_id:=p.id;c.user_id:=actor;c.join_original_id:=j.id;c.accepted_terms_digest:=p_cash_terms_digest;c.request_id:=p_request_id;c.accepted_at:=clock_timestamp();
 c.snapshot:=to_jsonb(c)-array['snapshot','digest'];c.digest:=app_private.funding_engine_digest(c.snapshot);
 insert into app_private.local_cash_consents select c.* on conflict(policy_id,user_id)do nothing;
 select * into c from app_private.local_cash_consents where policy_id=p.id and user_id=actor;
 if c.accepted_terms_digest<>p_cash_terms_digest then raise exception using errcode='55000',message='LOCAL_CASH_CONSENT_REPLAY_CONFLICT';end if;
 return result||jsonb_build_object('cashTermsDigest',p.digest,'cashTermsVersion',p.terms_version,'cashConsentRecorded',true,'scope','LOCAL_QA');
end;$$;

create or replace function app_private.domain_notification_copy(p_type text)returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
 return case p_type
 when 'REFERRAL_REWARD_PAID.v1'then jsonb_build_object('category','wallet','title','추천 보상이 지급됐어요','body','지갑에서 지급 내역을 확인해 주세요.','route','/wallet')
 when 'EVENT_REWARD_PAID.v1'then jsonb_build_object('category','wallet','title','행사 보상이 지급됐어요','body','지갑에서 지급 내역을 확인해 주세요.','route','/wallet')
 when 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' then jsonb_build_object('category','wallet','title','수동 입금이 확인됐어요','body','지갑에서 입금 내역을 확인해 주세요.','route','/wallet')
 when 'DEPOSIT_CONFIRMED.v1' then jsonb_build_object('category','wallet','title','입금이 확인됐어요','body','지갑에서 입금 내역을 확인해 주세요.','route','/wallet')
 when 'WITHDRAWAL_COMPLETED.v1' then jsonb_build_object('category','wallet','title','출금이 완료됐어요','body','지갑에서 출금 내역을 확인해 주세요.','route','/wallet')
 when 'TRIAL_REWARD_CONVERTED.v1' then jsonb_build_object('category','wallet','title','체험 보상이 전환됐어요','body','지갑에서 전환 내역을 확인해 주세요.','route','/wallet')
 when 'MINING_STARTED.v1' then jsonb_build_object('category','mining','title','채굴이 시작됐어요','body','채굴 화면에서 내 진행 상태를 확인해 주세요.','route','/mining')
 when 'MINING_SETTLEMENT_COMPLETED.v1' then jsonb_build_object('category','mining','title','채굴 결과가 반영됐어요','body','채굴 화면에서 결과를 확인해 주세요.','route','/mining')
 when 'TRIAL_COMPLETED.v1' then jsonb_build_object('category','trial','title','체험이 끝났어요','body','체험 화면에서 결과를 확인해 주세요.','route','/start')
 else null end;
end;$$;
commit;
