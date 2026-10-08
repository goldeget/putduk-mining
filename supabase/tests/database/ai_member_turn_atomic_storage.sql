-- REVIEW DRAFT ONLY: DB owner compiles/integrates/runs this file.
-- Current atomicity implementation, not historical Cloud restoration evidence.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(not (select prosecdef from pg_proc where oid='public.append_ai_member_turn(uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,text,integer)'::regprocedure), 'atomic helper does not introduce a definer');
select ok(has_function_privilege('service_role','public.append_ai_member_turn(uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.append_ai_member_turn(uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,text,integer)','EXECUTE')
  and not has_function_privilege('anon','public.append_ai_member_turn(uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,text,integer)','EXECUTE'), 'only server executor can append');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
values ('a7c00001-1009-4000-8000-000000000001','authenticated','authenticated','atomic-a@putduk.test','',now(),'{}','{}',now(),now(),'','','',''),
('a7c00001-1009-4000-8000-000000000002','authenticated','authenticated','atomic-b@putduk.test','',now(),'{}','{}',now(),now(),'','','','');
create temporary table atomic_receipts(label text primary key, receipt jsonb);
grant all on atomic_receipts to service_role;
create function pg_temp.append_fixture(client_id uuid, conv uuid default null, question text default '원래 질문', answers jsonb default '["답변"]') returns jsonb language sql security invoker as $$
  select public.append_ai_member_turn('a7c00001-1009-4000-8000-000000000001',client_id,conv,'원자 저장',jsonb_build_array(question),answers,'guide:provider','2026.09',null,null,null)
$$;
grant execute on function pg_temp.append_fixture(uuid,uuid,text,jsonb) to service_role;
set local role service_role;
insert into atomic_receipts values ('long',pg_temp.append_fixture('a7c00004-1009-4000-8000-000000000001',null,'원래 질문',jsonb_build_array(repeat('가',8000),repeat('나',8000),repeat('다',4000))));
select is((select count(*)::integer from public.ai_messages where conversation_id=(select (receipt->>'conversationId')::uuid from atomic_receipts where label='long')),4,'all long answer fragments are present');
select is((select string_agg(body_text,'' order by position) from public.ai_messages where author_role='ASSISTANT' and conversation_id=(select (receipt->>'conversationId')::uuid from atomic_receipts where label='long')),repeat('가',8000)||repeat('나',8000)||repeat('다',4000),'20k answer restored exactly');
select is((select count(*)::integer from public.ai_answer_sources where message_id=(select (receipt->>'assistantMessageId')::uuid from atomic_receipts where label='long')),1,'answer evidence committed with all fragments');
insert into atomic_receipts values ('replay',pg_temp.append_fixture('a7c00004-1009-4000-8000-000000000001',null,'원래 질문',jsonb_build_array(repeat('가',8000),repeat('나',8000),repeat('다',4000))));
select ok((select receipt->>'replay'='true' from atomic_receipts where label='replay') and (select receipt->>'assistantMessageId' from atomic_receipts where label='replay')=(select receipt->>'assistantMessageId' from atomic_receipts where label='long'),'exact replay preserves original receipt');
select is((select count(*)::integer from public.ai_messages where conversation_id=(select (receipt->>'conversationId')::uuid from atomic_receipts where label='long')),4,'replay does not duplicate rows');
select throws_ok($$select pg_temp.append_fixture('a7c00004-1009-4000-8000-000000000001',null,'변경된 질문')$$,'55000','AI_TURN_EXISTING_UNVERIFIED','different replay cannot claim saved success');
select throws_ok($$select public.append_ai_member_turn('a7c00001-1009-4000-8000-000000000002','a7c00004-1009-4000-8000-000000000002',(select (receipt->>'conversationId')::uuid from atomic_receipts where label='long'),'다른 회원','["질문"]','["답변"]','guide:provider',null,null,null,null)$$,'42501','AI_TURN_NOT_OWNED','cross-member conversation cannot be appended');
select throws_ok($$select pg_temp.append_fixture('a7c00004-1009-4000-8000-000000000003',null,'질문',jsonb_build_array(repeat('가',8001)))$$,'22023','INVALID_AI_TURN_PARTS','oversize fragments rejected before any write');

-- Real transaction exceptions occur after earlier message inserts.
reset role;
create function pg_temp.reject_fragment() returns trigger language plpgsql as $$ begin if new.body_text='ATOMIC_FAIL_SECOND' then raise exception using errcode='P0001',message='ATOMIC_INJECTED_FAILURE'; end if; return new; end $$;
create trigger atomic_test_fragment before insert on public.ai_messages for each row execute function pg_temp.reject_fragment();
set local role service_role;
select throws_ok($$select pg_temp.append_fixture('a7c00004-1009-4000-8000-000000000004',null,'질문','["첫 조각","ATOMIC_FAIL_SECOND"]')$$,'P0001','ATOMIC_INJECTED_FAILURE','failure in second assistant fragment rolls back turn');
select is((select count(*)::integer from public.ai_messages where client_message_id='a7c00004-1009-4000-8000-000000000004'),0,'failed turn leaves no member question');
select is((select count(*)::integer from public.ai_conversations where user_id='a7c00001-1009-4000-8000-000000000001'),1,'failed newly-created turn leaves no conversation');
reset role;
drop trigger atomic_test_fragment on public.ai_messages;
create function pg_temp.reject_evidence() returns trigger language plpgsql as $$ begin if new.source_key='guide:atomic_failure' then raise exception using errcode='P0001',message='ATOMIC_EVIDENCE_FAILURE'; end if; return new; end $$;
create trigger atomic_test_evidence before insert on public.ai_answer_sources for each row execute function pg_temp.reject_evidence();
set local role service_role;
select throws_ok($$select public.append_ai_member_turn('a7c00001-1009-4000-8000-000000000001','a7c00004-1009-4000-8000-000000000005',null,'증거 실패','["질문"]','["답변"]','guide:atomic_failure',null,null,null,null)$$,'P0001','ATOMIC_EVIDENCE_FAILURE','failure after all messages rolls back source and turn');
select is((select count(*)::integer from public.ai_messages where client_message_id='a7c00004-1009-4000-8000-000000000005'),0,'source failure leaves no partial question');
reset role;
drop trigger atomic_test_evidence on public.ai_answer_sources;
set local role service_role;

-- Preserve and reject an old incomplete turn instead of guessing completion.
insert into public.ai_messages(conversation_id,user_id,author_role,body_text,position,client_message_id) values ((select (receipt->>'conversationId')::uuid from atomic_receipts where label='long'),'a7c00001-1009-4000-8000-000000000001','MEMBER','불완전 질문',5,'a7c00004-1009-4000-8000-000000000006');
select throws_ok($$select pg_temp.append_fixture('a7c00004-1009-4000-8000-000000000006',null,'불완전 질문')$$,'55000','AI_TURN_EXISTING_UNVERIFIED','legacy partial record cannot masquerade as saved full turn');
select is((select count(*)::integer from public.ai_messages where client_message_id='a7c00004-1009-4000-8000-000000000006'),1,'legacy partial evidence preserved');

-- 5/10/20 original turn sequences: each case is a separate fresh conversation.
do $$ declare turns integer; n integer; c uuid; r jsonb; begin
  foreach turns in array array[5,10,20] loop
    c:=null;
    for n in 1..turns loop
      r:=pg_temp.append_fixture(gen_random_uuid(),c,'질문 '||n,'["답변"]'); c:=(r->>'conversationId')::uuid;
    end loop;
    insert into atomic_receipts values ('sequence-'||turns,r);
  end loop;
end $$;
select is((select count(*)::integer from public.ai_messages where conversation_id=(select (receipt->>'conversationId')::uuid from atomic_receipts where label='sequence-5')),10,'five original turns remain complete');
select is((select count(*)::integer from public.ai_messages where conversation_id=(select (receipt->>'conversationId')::uuid from atomic_receipts where label='sequence-10')),20,'ten original turns remain complete');
select is((select count(*)::integer from public.ai_messages where conversation_id=(select (receipt->>'conversationId')::uuid from atomic_receipts where label='sequence-20')),40,'twenty original turns remain complete');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','a7c00001-1009-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*)::integer from public.ai_messages where user_id='a7c00001-1009-4000-8000-000000000001'),0,'another member cannot restore these turns');
reset role;
select * from finish();
rollback;
-- Two-connection serialized writes/replay still require separate native harness.
