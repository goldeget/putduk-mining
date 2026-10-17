begin;
-- REVIEW DRAFT ONLY. DB owner registers/applies the migration.
-- Current owner-approved internal storage helper; not an exact Cloud artifact.
create function public.append_ai_member_turn(
  p_user_id uuid, p_client_message_id uuid, p_conversation_id uuid,
  p_title_text text, p_question_parts jsonb, p_answer_parts jsonb,
  p_source_key text, p_knowledge_version text,
  p_tool_name text, p_tool_outcome text, p_tool_latency_ms integer
) returns jsonb language plpgsql volatile security invoker
set search_path = pg_catalog as $$
declare
  conversation uuid; first_member public.ai_messages%rowtype;
  assistant uuid; start_position integer; question_count integer; answer_count integer;
  part text; part_index integer; stored public.ai_messages%rowtype;
begin
  if current_user <> 'service_role' or auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='AI_TURN_EXECUTOR_REQUIRED';
  end if;
  if p_user_id is null or p_client_message_id is null
    or jsonb_typeof(p_question_parts) is distinct from 'array'
    or jsonb_typeof(p_answer_parts) is distinct from 'array'
    or char_length(btrim(coalesce(p_title_text,''))) not between 1 and 80
    or char_length(btrim(coalesce(p_source_key,''))) not between 1 and 160
    or (p_tool_name is null) <> (p_tool_outcome is null)
    or (p_tool_name is null and p_tool_latency_ms is not null)
    or (p_tool_name is null and p_source_key like 'tool:%')
    or (p_tool_name is not null and p_source_key is distinct from 'tool:' || p_tool_name)
    or (p_tool_name is not null and (p_tool_name !~ '^[a-z][a-z0-9_.]{0,79}$'
      or p_tool_outcome not in ('FAILED','SUCCEEDED')))
    or p_tool_latency_ms < 0
    or char_length(coalesce(p_knowledge_version,''))>160 then
    raise exception using errcode='22023', message='INVALID_AI_TURN';
  end if;
  question_count := jsonb_array_length(p_question_parts);
  answer_count := jsonb_array_length(p_answer_parts);
  if question_count not between 1 and 4 or answer_count not between 1 and 8
    or exists (select 1 from jsonb_array_elements(p_question_parts || p_answer_parts) v
      where jsonb_typeof(v) <> 'string' or char_length(btrim(v #>> '{}')) not between 1 and 8000) then
    raise exception using errcode='22023', message='INVALID_AI_TURN_PARTS';
  end if;
  -- Same original client request cannot race into different conversations.
  perform pg_advisory_xact_lock(hashtextextended('putduk-ai-turn:' || p_user_id::text || ':' || p_client_message_id::text, 0));
  select * into first_member from public.ai_messages
    where user_id=p_user_id and client_message_id=p_client_message_id;
  if first_member.id is not null then
    conversation := first_member.conversation_id;
    if p_conversation_id is not null and conversation <> p_conversation_id then
      raise exception using errcode='42501', message='AI_TURN_NOT_OWNED';
    end if;
  else conversation := p_conversation_id; end if;
  if conversation is null then
    insert into public.ai_conversations(user_id,title_text)
      values(p_user_id,p_title_text) returning id into conversation;
  else
    perform 1 from public.ai_conversations where id=conversation and user_id=p_user_id for update;
    if not found then raise exception using errcode='42501', message='AI_TURN_NOT_OWNED'; end if;
  end if;
  if first_member.id is not null then
    start_position := first_member.position;
    for part_index in 0..question_count+answer_count-1 loop
      select * into stored from public.ai_messages
        where conversation_id=conversation and user_id=p_user_id and position=start_position+part_index;
      if stored.id is null
        or stored.author_role <> (case when part_index<question_count then 'MEMBER' else 'ASSISTANT' end)
        or stored.body_text is distinct from (case when part_index<question_count
          then p_question_parts->>part_index else p_answer_parts->>(part_index-question_count) end)
        or stored.client_message_id is distinct from (case when part_index=0 then p_client_message_id else null::uuid end) then
        raise exception using errcode='55000', message='AI_TURN_EXISTING_UNVERIFIED';
      end if;
      if part_index=question_count then assistant:=stored.id; end if;
    end loop;
    if exists(select 1 from public.ai_messages where conversation_id=conversation and user_id=p_user_id
      and position=start_position+question_count+answer_count and author_role<>'MEMBER')
      or (select count(*) from public.ai_answer_sources where conversation_id=conversation and user_id=p_user_id and message_id=assistant) <> 1
      or not exists(select 1 from public.ai_answer_sources where conversation_id=conversation and user_id=p_user_id and message_id=assistant
        and position=1 and source_key=p_source_key and knowledge_version is not distinct from p_knowledge_version)
      or (select count(*) from public.ai_tool_calls where conversation_id=conversation and user_id=p_user_id and message_id=assistant)
         <> (case when p_tool_name is null then 0 else 1 end)
      or (p_tool_name is not null and not exists(select 1 from public.ai_tool_calls
        where conversation_id=conversation and user_id=p_user_id and message_id=assistant and position=1
        and tool_name=p_tool_name and outcome=p_tool_outcome and latency_ms is not distinct from p_tool_latency_ms)) then
      raise exception using errcode='55000', message='AI_TURN_EXISTING_UNVERIFIED';
    end if;
    return jsonb_build_object('conversationId',conversation,'assistantMessageId',assistant,'replay',true);
  end if;
  select coalesce(max(position),0)+1 into start_position from public.ai_messages where conversation_id=conversation and user_id=p_user_id;
  for part_index in 0..question_count-1 loop
    part := p_question_parts->>part_index;
    insert into public.ai_messages(conversation_id,user_id,author_role,body_text,position,client_message_id)
      values(conversation,p_user_id,'MEMBER',part,start_position+part_index,case when part_index=0 then p_client_message_id else null end);
  end loop;
  for part_index in 0..answer_count-1 loop
    insert into public.ai_messages(conversation_id,user_id,author_role,body_text,position)
      values(conversation,p_user_id,'ASSISTANT',p_answer_parts->>part_index,start_position+question_count+part_index)
      returning id into stored.id;
    if part_index=0 then assistant:=stored.id; end if;
  end loop;
  insert into public.ai_answer_sources(conversation_id,user_id,message_id,author_role,position,source_key,knowledge_version)
    values(conversation,p_user_id,assistant,'ASSISTANT',1,p_source_key,p_knowledge_version);
  if p_tool_name is not null then
    insert into public.ai_tool_calls(conversation_id,user_id,message_id,author_role,position,tool_name,outcome,latency_ms)
      values(conversation,p_user_id,assistant,'ASSISTANT',1,p_tool_name,p_tool_outcome,p_tool_latency_ms);
  end if;
  update public.ai_conversations set updated_at=statement_timestamp() where id=conversation and user_id=p_user_id;
  return jsonb_build_object('conversationId',conversation,'assistantMessageId',assistant,'replay',false);
end;
$$;
revoke all on function public.append_ai_member_turn(uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.append_ai_member_turn(uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,text,integer) to service_role;

commit;
