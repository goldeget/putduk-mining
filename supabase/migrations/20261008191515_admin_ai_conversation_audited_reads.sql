begin;
-- Original Cloud canonical read command. Proof is resolved from current Auth
-- records, never from the browser's AAL/role claim or a previous read receipt.
create or replace function app_private.assert_recovery_admin_session(p_actor uuid,p_session uuid,p_roles text[])
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare session public.admin_sessions%rowtype;
begin
 perform app_private.assert_ai_provider_executor();
 perform user_id from public.user_roles where user_id=p_actor and revoked_at is null and role::text=any(p_roles) for share;
 if not found then
  raise exception using errcode='42501',message='ROLE_FORBIDDEN'; end if;
 select * into session from public.admin_sessions where id=p_session and user_id=p_actor for share;
 if session.id is null then raise exception using errcode='42501',message='ADMIN_SESSION_REQUIRED'; end if;
 if session.revoked_at is not null then raise exception using errcode='42501',message='ADMIN_SESSION_REVOKED'; end if;
 if least(session.idle_expires_at,session.absolute_expires_at)<=clock_timestamp() then
  raise exception using errcode='42501',message='ADMIN_SESSION_EXPIRED'; end if;
 perform s.id from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
  join auth.mfa_amr_claims amr on amr.session_id=s.id and amr.authentication_method='totp'
  where s.id::text=session.auth_session_id and s.user_id=p_actor and s.aal::text='aal2'
   and (s.not_after is null or s.not_after>clock_timestamp()) and f.factor_type::text='totp' and f.status::text='verified'
  for share of s,f,amr;
 if not found then
  raise exception using errcode='42501',message='ADMIN_SESSION_REQUIRED'; end if;
 return session.id;
end; $$;
revoke all on function app_private.assert_recovery_admin_session(uuid,uuid,text[]) from public,anon,authenticated,service_role;

create or replace function public.admin_read_ai_conversations(p_actor uuid,p_admin_session_id uuid,p_request_id uuid,p_operation text,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare data jsonb; result_rows jsonb; extra_rows jsonb; audit uuid:=gen_random_uuid();
 page_limit integer; after_position integer; target_user uuid; conversation uuid;
 cursor_at timestamptz; cursor_id uuid; from_at timestamptz; to_at timestamptz;
 query text; search_kind text; search_phone text; last_position integer; has_more boolean; err text;
begin
 perform app_private.assert_ai_provider_executor();
 begin
  perform app_private.assert_recovery_admin_session(p_actor,p_admin_session_id,array['SUPER_ADMIN']);
  if p_request_id is null or p_operation not in('SEARCH','LIST','MESSAGES') or p_operation is null
   or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'INVALID_INPUT'; end if;
  if p_operation='SEARCH' then
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in('kind','value','phone')) then raise exception 'INVALID_INPUT'; end if;
   query:=btrim(p_input->>'value'); search_kind:=p_input->>'kind'; search_phone:=p_input->>'phone';
   if search_kind not in('UUID','TEXT','PHONE') or search_kind is null or query is null or char_length(query) not between 2 and 40
    or query~'[[:cntrl:]*]' or (search_kind='UUID' and query!~'^[a-f0-9-]{36}$')
    or (search_phone is not null and search_phone!~'^\+[1-9][0-9]{7,14}$') then raise exception 'INVALID_INPUT'; end if;
   with matched as(select u.id,p.legal_name,p.login_id,p.phone_e164 from auth.users u
    left join public.user_identity_profiles p on p.user_id=u.id
    where (search_kind='UUID' and u.id::text=query) or (search_kind<>'UUID' and
     (strpos(lower(p.legal_name),lower(query))>0 or strpos(lower(p.login_id),lower(query))>0 or p.phone_e164=search_phone))
    order by u.id limit 21), bounded as(select * from matched order by id limit 20)
   select jsonb_build_object('members',coalesce(jsonb_agg(jsonb_build_object('userId',id,
    'name',case when legal_name is null then '이름 미설정' when char_length(legal_name)=2 then left(legal_name,1)||'*'
      else left(legal_name,1)||repeat('*',greatest(1,char_length(legal_name)-2))||right(legal_name,1) end,
    'loginId',case when login_id is null then null when char_length(login_id)<=5 then left(login_id,2)||'***'
      else left(login_id,2)||repeat('*',char_length(login_id)-4)||right(login_id,2) end,
    'phone',case when phone_e164 is null then null else '•••• '||right(phone_e164,4) end) order by id),'[]'::jsonb),
    'hasMore',(select count(*)>20 from matched)) into data from bounded;
  elsif p_operation='LIST' then
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in('operation','userId','from','to','status','cursor','limit'))
    or (p_input?'operation' and p_input->>'operation'<>'LIST') then raise exception 'INVALID_INPUT'; end if;
   target_user:=(p_input->>'userId')::uuid; from_at:=(p_input->>'from')::timestamptz; to_at:=(p_input->>'to')::timestamptz;
   cursor_at:=(p_input->'cursor'->>'updatedAt')::timestamptz; cursor_id:=(p_input->'cursor'->>'id')::uuid;
   page_limit:=coalesce((p_input->>'limit')::integer,25);
   if page_limit not between 1 and 50 or (from_at is not null and to_at is not null and from_at>=to_at)
    or ((cursor_at is null)<>(cursor_id is null)) or (p_input?'status' and p_input->>'status' not in('RECEIVED','RUNNING','SUCCEEDED','FAILED','CANCELLED')) then raise exception 'INVALID_INPUT'; end if;
   with matched as(select c.* from public.ai_conversations c where (target_user is null or c.user_id=target_user)
    and (from_at is null or c.updated_at>=from_at) and (to_at is null or c.updated_at<to_at)
    and (cursor_at is null or (c.updated_at,c.id)<(cursor_at,cursor_id))
    and (not p_input?'status' or exists(select 1 from public.ai_messages m join public.ai_requests r
      on r.user_id=m.user_id and r.client_message_id=m.client_message_id where m.conversation_id=c.id and r.status::text=p_input->>'status'))
    order by c.updated_at desc,c.id desc limit page_limit+1), bounded as(select * from matched order by updated_at desc,id desc limit page_limit)
   select jsonb_build_object('conversations',coalesce(jsonb_agg(jsonb_build_object('id',id,'userId',user_id,'title',title_text,
     'createdAt',created_at,'updatedAt',updated_at) order by updated_at desc,id desc),'[]'::jsonb),
    'nextCursor',case when (select count(*) from matched)>page_limit then
     (select jsonb_build_object('updatedAt',updated_at,'id',id) from bounded order by updated_at,id limit 1) else null end) into data from bounded;
  else
   if exists(select 1 from jsonb_object_keys(p_input) k where k not in('operation','userId','conversationId','afterPosition','limit'))
    or (p_input?'operation' and p_input->>'operation'<>'MESSAGES') then raise exception 'INVALID_INPUT'; end if;
   target_user:=(p_input->>'userId')::uuid; conversation:=(p_input->>'conversationId')::uuid;
   after_position:=coalesce((p_input->>'afterPosition')::integer,0); page_limit:=coalesce((p_input->>'limit')::integer,50);
   if target_user is null or conversation is null or after_position<0 or page_limit not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
   if not exists(select 1 from public.ai_conversations where id=conversation and user_id=target_user) then raise exception 'NOT_FOUND'; end if;
   with messages as(select * from public.ai_messages where conversation_id=conversation and user_id=target_user
    and position>after_position order by position limit page_limit)
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'authorRole',author_role,'bodyText',body_text,'position',position,
    'createdAt',created_at,'clientMessageId',client_message_id) order by position),'[]'::jsonb),max(position)
    into result_rows,last_position from messages;
   select exists(select 1 from public.ai_messages where conversation_id=conversation and user_id=target_user
    and position>coalesce(last_position,after_position)) into has_more;
   select coalesce(jsonb_agg(jsonb_build_object('requestId',r.id,'clientMessageId',r.client_message_id,'status',r.status,
     'model',r.model_key,'provider',latest.provider,'upstreamProvider',latest.upstream_provider,
     'providerCostNanoUsd',usage.cost_nano,'inputTokens',usage.input_tokens,'outputTokens',usage.output_tokens,
     'usageStatus',case when usage.attempt_count=0 then null when usage.cost_nano is null then 'UNKNOWN' else 'REPORTED' end,
     'errorCode',r.error_code,'createdAt',r.created_at,'completedAt',r.completed_at,'attempts',usage.attempts)
     order by r.created_at,r.id),'[]'::jsonb) into extra_rows
   from public.ai_requests r
   left join lateral(select a.provider,a.upstream_provider from app_private.ai_provider_attempts a where a.request_id=r.id
    order by a.created_at desc,a.id desc limit 1) latest on true
   cross join lateral(select count(*) attempt_count,
    case when count(*) filter(where provider_cost_nano_usd is null)=0 and count(*)>0 then sum(provider_cost_nano_usd)::text end cost_nano,
    case when count(*) filter(where input_tokens is null)=0 and count(*)>0 then sum(input_tokens) end input_tokens,
    case when count(*) filter(where output_tokens is null)=0 and count(*)>0 then sum(output_tokens) end output_tokens,
    coalesce(jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'provider',a.provider,'modelKey',a.model_key,'paid',a.paid,
     'providerRequestId',a.provider_request_id,'upstreamProvider',a.upstream_provider,'providerCostNanoUsd',a.provider_cost_nano_usd::text,
     'chargedCostMicroUsd',a.charged_cost_micro_usd::text,'reservedCostMicroUsd',a.reserved_cost_micro_usd::text,
     'inputTokens',a.input_tokens::text,'outputTokens',a.output_tokens::text,'cachedInputTokens',a.cached_input_tokens::text,
     'createdAt',a.created_at,'updatedAt',coalesce((select max(e.occurred_at) from app_private.ai_provider_attempt_events e where e.attempt_id=a.id),a.created_at))
     order by a.created_at,a.id),'[]'::jsonb) attempts
    from app_private.ai_provider_attempts a where a.request_id=r.id and a.user_id=target_user) usage
   where r.user_id=target_user and r.client_message_id in(select m.client_message_id from public.ai_messages m
    where m.conversation_id=conversation and m.user_id=target_user and m.author_role='MEMBER'
     and m.position>after_position and m.position<=last_position);
   data:=jsonb_build_object('conversationId',conversation,'userId',target_user,'messages',result_rows,'requests',extra_rows,
    'nextPosition',case when has_more then last_position else null end);
  end if;
  insert into public.audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
  values(audit,p_actor,'SUPER_ADMIN','ADMIN_AI_CONVERSATION_READ','AI_CONVERSATION',coalesce(conversation::text,target_user::text),
   '회원 상담 기록을 권한과 접속 상태를 확인한 뒤 조회합니다.',p_request_id,
   jsonb_build_object('operation',p_operation,'admin_session_id',p_admin_session_id,
    'input_digest',encode(extensions.digest(p_input::text,'sha256'),'hex'),'record_count',
     coalesce(jsonb_array_length(data->'messages'),jsonb_array_length(data->'conversations'),jsonb_array_length(data->'members'),0)));
  return jsonb_build_object('ok',true,'data',data);
 exception when others then
  err:=sqlerrm;
  if err not in('ROLE_FORBIDDEN','ADMIN_SESSION_REQUIRED','ADMIN_SESSION_REVOKED','ADMIN_SESSION_EXPIRED','INVALID_INPUT','NOT_FOUND') then err:='READ_UNAVAILABLE'; end if;
  -- Unverified identity/search/transcript is never put into a denial audit.
  insert into public.audit_logs(actor_user_id,actor_role,action,target_type,reason,request_id,metadata)
  values(null,null,'ADMIN_AI_READ_DENIED','AI_CONVERSATION','회원 상담 기록 접근이 제한되었습니다.',coalesce(p_request_id,gen_random_uuid()),
   jsonb_build_object('code',err));
  return jsonb_build_object('ok',false,'code',err);
 end;
end; $$;
revoke all on function public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
