begin;
-- Semantically unchanged source cleanup: explicit jsonb literals and the implicit
-- integer loop iterator. No command names, grants, amounts or validation change.
create or replace function app_private.funding_exact_retention_terminal_overlay(
 p_unqualified jsonb,p_incoming_carry_num numeric,p_incoming_carry_den numeric,
 p_qualified_num numeric,p_qualified_den numeric,p_component_total_num numeric,p_component_total_den numeric
) returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare incoming numeric[];base numeric[];qualified numeric[];source_total numeric[];
 unqualified_total numeric[];terminal_total numeric[];outgoing numeric[];whole numeric;key text;
begin
 if jsonb_typeof(p_unqualified) is distinct from 'object'
  or p_unqualified->>'qualifiedRetentionNum' is distinct from '0'
  or p_unqualified->>'qualifiedRetentionDen' is distinct from '1' then
  raise exception using errcode='22023',message='FUNDING_RETENTION_UNQUALIFIED_CALCULATION_REQUIRED';end if;
 foreach key in array array['baseNum','baseDen','baseUsedNum','baseUsedDen',
  'conditionalRetentionNum','conditionalRetentionDen','retentionUsedNum','retentionUsedDen',
  'baseCapacityNum','baseCapacityDen','retentionCapacityNum','retentionCapacityDen','amountAtomic','carryNum','carryDen'] loop
  if jsonb_typeof(p_unqualified->key) is distinct from 'string'
   or coalesce(p_unqualified->>key,'') !~ '^(0|[1-9][0-9]*)$' then
   raise exception using errcode='22023',message='FUNDING_RETENTION_CALCULATION_SHAPE_INVALID';end if;
 end loop;
 incoming:=app_private.funding_exact_ratio(p_incoming_carry_num,p_incoming_carry_den);
 base:=app_private.funding_exact_ratio((p_unqualified->>'baseNum')::numeric,(p_unqualified->>'baseDen')::numeric);
 qualified:=app_private.funding_exact_ratio(p_qualified_num,p_qualified_den);
 source_total:=app_private.funding_exact_ratio(p_component_total_num,p_component_total_den);
 if incoming[1]>=incoming[2] then raise exception using errcode='22023',message='FUNDING_CARRY_INVALID';end if;
 if qualified[1]*source_total[2]>source_total[1]*qualified[2] then
  raise exception using errcode='22023',message='FUNDING_RETENTION_COMPONENT_TOTAL_INVALID';end if;
 unqualified_total:=app_private.funding_exact_sum(incoming,base);
 if div(unqualified_total[1],unqualified_total[2])::text is distinct from p_unqualified->>'amountAtomic'
  or app_private.funding_exact_ratio(mod(unqualified_total[1],unqualified_total[2]),unqualified_total[2])
    is distinct from array[(p_unqualified->>'carryNum')::numeric,(p_unqualified->>'carryDen')::numeric] then
  raise exception using errcode='22023',message='FUNDING_RETENTION_INCOMING_CARRY_MISMATCH';end if;
 terminal_total:=app_private.funding_exact_sum(unqualified_total,qualified);
 whole:=div(terminal_total[1],terminal_total[2]);
 if whole>9223372036854775807 then raise exception using errcode='22003',message='FUNDING_REWARD_OVERFLOW';end if;
 outgoing:=app_private.funding_exact_ratio(mod(terminal_total[1],terminal_total[2]),terminal_total[2]);
 return p_unqualified||jsonb_object(array['qualifiedRetentionNum','qualifiedRetentionDen','amountAtomic','carryNum','carryDen'],
  array[qualified[1]::text,qualified[2]::text,whole::text,outgoing[1]::text,outgoing[2]::text])
  ||'{"retentionTerminalContractVersion":1}'::jsonb;
end; $$;
create or replace function app_private.read_cycle_retention_components(p_state uuid,p_asof timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare s app_private.funding_engine_state_receipts%rowtype;c app_private.funding_cycle_windows%rowtype;
 activation app_private.funding_engine_activations%rowtype;condition app_private.funding_condition_originals%rowtype;
 transition app_private.funding_portion_transitions%rowtype;leaf record;segment record;
 total numeric[]:=array[0::numeric,1::numeric];qualified numeric[]:=array[0::numeric,1::numeric];piece numeric[];
 timeline jsonb;components jsonb:='[]'::jsonb;conditions jsonb:='[]'::jsonb;last_revision bigint:=-1;previous uuid;duration bigint;
begin
 if current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED';end if;
 select * into s from app_private.funding_engine_state_receipts where id=p_state;
 select * into c from app_private.funding_cycle_windows where id=s.cycle_id;
 select * into activation from app_private.funding_engine_activations where id=s.activation_id;
 if s.id is null or c.id is null or activation.id is null or activation.user_id is distinct from s.user_id
  or c.user_id is distinct from s.user_id or (c.id is distinct from activation.first_cycle_id and not exists(
 select 1 from app_private.funding_cycle_rollovers r where r.next_cycle_id=c.id and r.activation_id=activation.id))
  or p_asof is distinct from c.cycle_end or c.cycle_end-c.cycle_started_at<>interval '30 days'
  or s.cursor_at>p_asof then raise exception using errcode='55000',message='FUNDING_RETENTION_CYCLE_ORIGINAL_REQUIRED';end if;
 if p_asof>clock_timestamp() then raise exception using errcode='55000',message='FUNDING_RETENTION_END_NOT_MATURE';end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||s.user_id::text,0));
 duration:=(extract(epoch from c.cycle_end-c.cycle_started_at)*1000000)::bigint;
 perform app_private.assert_funding_engine_seal(activation.id,'FUNDING_ACTIVATED',activation.user_id,activation.input_digest,
  activation.audit_id,activation.source_event_id,app_private.funding_activation_snapshot(activation));
 for condition in select * from app_private.funding_condition_originals
  where activation_id=activation.id and effective_at<p_asof order by revision loop
  if condition.user_id is distinct from s.user_id or condition.revision<>last_revision+1
   or condition.previous_condition_id is distinct from previous
   or condition.inputs->>'cycle_days'<>'30'
   or coalesce((condition.inputs->>'retention_bps')::integer,-1) not between 0 and 10000 then
   raise exception using errcode='55000',message='FUNDING_RETENTION_CONDITION_CHAIN_INVALID';end if;
  perform app_private.assert_funding_engine_seal(condition.id,'FUNDING_CONDITION_CHANGED',s.user_id,condition.input_digest,
   condition.audit_id,condition.source_event_id,app_private.funding_condition_snapshot(condition));
  conditions:=conditions||jsonb_build_array(jsonb_build_object('id',condition.id,'digest',condition.input_digest));
  previous:=condition.id;last_revision:=condition.revision;
 end loop;
 if last_revision<0 or previous is distinct from s.condition_id then
  raise exception using errcode='55000',message='FUNDING_RETENTION_CONDITION_CHAIN_INVALID';end if;
 for transition in select * from app_private.funding_portion_transitions
  where user_id=s.user_id and effective_at<=p_asof order by revision loop
  perform app_private.verify_funding_portion_fact(transition);
 end loop;
 -- Each as-of-end leaf owns its fractional amount through all parent clocks.
 -- Parent intervals end at SPLIT; descendants inherit prior eligible history
 -- without duplicating the parent amount, and HOLD intervals contribute zero.
 for leaf in
  with clocks as(select distinct on(portion_id) * from app_private.funding_portion_clock_receipts
   where user_id=s.user_id and effective_at<=p_asof order by portion_id,revision desc)
  select p.*,cl.id clock_id,cl.status from app_private.funding_principal_portions p join clocks cl on cl.portion_id=p.id
  join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
  where p.user_id=s.user_id and t.effective_at<=p_asof
   and not exists(select 1 from app_private.funding_principal_portions child
    join app_private.funding_portion_transitions ct on ct.id=child.introduced_by_transition_id
    where child.parent_portion_id=p.id and ct.effective_at<=p_asof) order by p.id loop
  if leaf.status not in('AVAILABLE','HELD','RECOVERED') then
   raise exception using errcode='55000',message='FUNDING_RETENTION_PORTION_LEAF_INVALID';end if;
  for segment in
   with recursive ancestry as(
    select p.id,p.parent_portion_id,p.user_id,array[p.id] path from app_private.funding_principal_portions p where p.id=leaf.id
    union all select p.id,p.parent_portion_id,p.user_id,a.path||p.id from app_private.funding_principal_portions p
     join ancestry a on p.id=a.parent_portion_id where not p.id=any(a.path) and cardinality(a.path)<1024),
   clocks as(select cl.*,lead(cl.effective_at) over(partition by cl.portion_id order by cl.revision) until_at
    from app_private.funding_portion_clock_receipts cl join ancestry a on a.id=cl.portion_id where a.user_id=s.user_id),
   policies as(select x.*,lead(x.effective_at) over(order by x.revision) until_at
    from app_private.funding_condition_originals x where x.activation_id=activation.id),
   windows as(select cl.id clock_id,p.id condition_id,(p.inputs->>'retention_bps')::integer bps,
    greatest(cl.effective_at,p.effective_at,c.cycle_started_at) from_at,
    least(coalesce(cl.until_at,p_asof),coalesce(p.until_at,p_asof),p_asof) to_at
    from clocks cl cross join policies p where cl.status='AVAILABLE')
   select * from windows where to_at>from_at order by from_at,clock_id,condition_id loop
   timeline:=app_private.funding_global_eligible_interval(segment.from_at,segment.to_at);
   piece:=app_private.funding_portion_cycle_retention(leaf.amount_micro_krw,segment.bps,
    (timeline->>'eligible_microseconds')::bigint,duration,true);
   total:=app_private.funding_exact_sum(total,piece);
   if leaf.status='AVAILABLE' then qualified:=app_private.funding_exact_sum(qualified,piece);end if;
   components:=components||jsonb_build_array(jsonb_build_object('portionId',leaf.id,'lotId',leaf.lot_id,
    'terminalClockId',leaf.clock_id,'terminalStatus',leaf.status,'amountMicroKrw',leaf.amount_micro_krw::text,
    'clockId',segment.clock_id,'conditionId',segment.condition_id,'from',segment.from_at,'to',segment.to_at,
    'eligibleMicroseconds',timeline->>'eligible_microseconds','retentionBps',segment.bps,
    'conditionalNum',piece[1]::text,'conditionalDen',piece[2]::text,'qualified',leaf.status='AVAILABLE',
    'globalControlOriginalIds',timeline->'control_original_ids'));
  end loop;
 end loop;
 return jsonb_build_object('contractVersion',1,'userId',s.user_id,'cycleId',c.id,'terminalAt',p_asof,
  'durationMicroseconds',duration::text,'conditionOriginals',conditions,'components',components,
  'qualifiedNum',qualified[1]::text,'qualifiedDen',qualified[2]::text,
  'conditionalNum',total[1]::text,'conditionalDen',total[2]::text);
end; $$;
create or replace function public.append_ai_member_turn(
  p_user_id uuid, p_client_message_id uuid, p_conversation_id uuid,
  p_title_text text, p_question_parts jsonb, p_answer_parts jsonb,
  p_source_key text, p_knowledge_version text,
  p_tool_name text, p_tool_outcome text, p_tool_latency_ms integer
) returns jsonb language plpgsql volatile security invoker
set search_path = pg_catalog as $$
declare
  conversation uuid; first_member public.ai_messages%rowtype;
  assistant uuid; start_position integer; question_count integer; answer_count integer;
  part text; stored public.ai_messages%rowtype;
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
commit;
