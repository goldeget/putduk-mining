begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Fresh disposable local DB only. Synthetic members, rollback-only, no providers.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
 confirmation_token,recovery_token,email_change,email_change_token_new)
select id,'authenticated','authenticated',email,'',now(),'{}','{}',now(),now(),'','','',''
from (values
 ('d0000001-0000-4000-8000-000000000001'::uuid,'ai-cap-minute@putduk.test'),
 ('d0000001-0000-4000-8000-000000000002'::uuid,'ai-cap-other@putduk.test'),
 ('d0000001-0000-4000-8000-000000000003'::uuid,'ai-cap-daily@putduk.test')) u(id,email);
create function pg_temp.admit_cap(m integer,d integer,owner_id uuid default 'd0000001-0000-4000-8000-000000000001',
 message_id uuid default gen_random_uuid(), redacted jsonb default '{}')
returns table(request_id uuid,is_new boolean) language sql as $$
 select * from public.begin_ai_request(owner_id,message_id,repeat('a',64),redacted,
 'openai/gpt-oss-20b','local-hardcap',m,d)
$$;
select ok(not (select prosecdef from pg_proc where oid='public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)'::regprocedure),
 'common admission stays SECURITY INVOKER');
select ok(not has_function_privilege('authenticated','public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)','execute')
 and not has_function_privilege('anon','public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)','execute')
 and has_function_privilege('service_role','public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)','execute'),
 'common admission retains server-only ACL');
select throws_ok($$select * from pg_temp.admit_cap(6,100)$$,'22023','INVALID_AI_REQUEST','minute ceiling cannot be raised');
select throws_ok($$select * from pg_temp.admit_cap(5,101)$$,'22023','INVALID_AI_REQUEST','daily ceiling cannot be raised');
select throws_ok($$select * from pg_temp.admit_cap(null,100)$$,'22023','INVALID_AI_REQUEST','NULL minute cannot bypass counter');
select throws_ok($$select * from pg_temp.admit_cap(5,null)$$,'22023','INVALID_AI_REQUEST','NULL daily cannot bypass counter');
select throws_ok($$select * from pg_temp.admit_cap(0,100)$$,'22023','INVALID_AI_REQUEST','zero minute is rejected');
select throws_ok($$select * from pg_temp.admit_cap(5,0)$$,'22023','INVALID_AI_REQUEST','zero daily is rejected');
select throws_ok($$select * from pg_temp.admit_cap(5,100,'d0000001-0000-4000-8000-000000000001',gen_random_uuid(),null)$$,
 '22023','INVALID_AI_REQUEST','SQL NULL redaction rejected before insert');
select throws_ok($$select * from public.begin_ai_request_v2('d0000001-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),'{}',
 'openai/gpt-oss-20b','local-hardcap',60,100,'general_safe','general_safe','GENERAL_SAFE','GENERAL_SAFE',null)$$,
 '22023','INVALID_AI_REQUEST','current v2 general NVIDIA path cannot bypass common ceiling');
create temporary table cap_admissions as select * from pg_temp.admit_cap(5,100,
 'd0000001-0000-4000-8000-000000000001','d0000002-0000-4000-8000-000000000001');
select is((select count(*) from public.ai_requests where user_id='d0000001-0000-4000-8000-000000000001'),1::bigint,
 'first request stored once');
select is((select count(*) from generate_series(1,4) n cross join lateral pg_temp.admit_cap(5,100,
 'd0000001-0000-4000-8000-000000000001',('d0000002-0000-4000-8000-'||lpad((n+1)::text,12,'0'))::uuid) a where a.is_new),4::bigint,
 'remaining four minute admissions succeed');
select throws_ok($$select * from pg_temp.admit_cap(5,100)$$,'P0001','AI_RATE_LIMITED_MINUTE','sixth minute request blocked');
select ok((select not a.is_new and a.request_id=c.request_id from pg_temp.admit_cap(5,100,
 'd0000001-0000-4000-8000-000000000001','d0000002-0000-4000-8000-000000000001') a cross join cap_admissions c),
 'duplicate at minute cap restores same original, no extra admission');
select ok((select is_new from pg_temp.admit_cap(5,100,'d0000001-0000-4000-8000-000000000002')),
 'another member keeps an independent counter');
-- Historical source rows model 99 already admitted requests in the rolling day;
-- direct fixture insertion does not pretend 99 synchronous requests were allowed.
insert into public.ai_requests(user_id,request_kind,client_message_id,prompt_hash,input_redacted,status,model_key,knowledge_version,created_at)
select 'd0000001-0000-4000-8000-000000000003','public_facts_question',gen_random_uuid(),repeat('b',64),'{}',
 (case n%3 when 0 then 'FAILED' when 1 then 'CANCELLED' else 'RUNNING' end)::public.ai_request_status,
 'openai/gpt-oss-20b','local-hardcap',statement_timestamp()-interval '2 minutes'
from generate_series(1,99) n;
create temporary table daily_cap_admission as select * from pg_temp.admit_cap(5,100,
 'd0000001-0000-4000-8000-000000000003','d0000002-0000-4000-8000-000000000100');
select ok((select is_new from daily_cap_admission),'100th rolling-day admission succeeds');
select throws_ok($$select * from pg_temp.admit_cap(5,100,'d0000001-0000-4000-8000-000000000003')$$,
 'P0001','AI_RATE_LIMITED_DAY','101st daily admission blocked across all request statuses');
select ok((select not a.is_new and a.request_id=c.request_id from pg_temp.admit_cap(5,100,
 'd0000001-0000-4000-8000-000000000003','d0000002-0000-4000-8000-000000000100') a cross join daily_cap_admission c),
 'duplicate at daily cap retains original admission');
select is((select count(*) from public.ai_requests where user_id='d0000001-0000-4000-8000-000000000003'),100::bigint,
 'rejections and replay cannot add rows beyond the daily cap');
select * from finish();
rollback;
