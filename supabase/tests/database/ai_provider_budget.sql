begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic local provider evidence only; no HTTP/provider request is executed.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
 confirmation_token,recovery_token,email_change,email_change_token_new)
values ('aa000000-0000-4000-8000-000000000001','authenticated','authenticated','ai-budget-1@putduk.test','',now(),'{}','{}',now(),now(),'','','',''),
 ('aa000000-0000-4000-8000-000000000002','authenticated','authenticated','ai-budget-2@putduk.test','',now(),'{}','{}',now(),now(),'','','','');
create temporary table ai_budget_requests(n integer primary key, id uuid, user_id uuid);
-- Preserve all twelve provider-state cases without bypassing the member 5/minute cap.
-- Only these synthetic request timestamps are moved outside the minute window;
-- all remain inside the daily window and no provider/budget evidence is changed.
do $$
declare fixture_n integer; fixture_request uuid;
begin
 for fixture_n in 1..12 loop
  select request_id into fixture_request from public.begin_ai_request(
   'aa000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),
   jsonb_build_object('fixture',fixture_n),'approved-model','local-recovery',5,100);
  insert into ai_budget_requests values
   (fixture_n,fixture_request,'aa000000-0000-4000-8000-000000000001');
  update public.ai_requests set created_at=statement_timestamp()-interval '2 minutes'
   where id=fixture_request;
 end loop;
end; $$;
insert into ai_budget_requests
select 13, request_id, 'aa000000-0000-4000-8000-000000000002'::uuid
from public.begin_ai_request('aa000000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('b',64),'{}','approved-model','local-recovery',5,100);

create function pg_temp.provider_command(command text) returns jsonb
language plpgsql as $$
declare result jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 set local role service_role;
 execute command into result;
 reset role;
 return result;
exception when others then reset role; raise;
end; $$;
create function pg_temp.reserve(n integer, paid boolean, amount bigint, provider text default 'openrouter', model text default null)
returns jsonb language plpgsql as $$
declare r record;
begin
 select * into r from ai_budget_requests where ai_budget_requests.n=reserve.n;
 return pg_temp.provider_command(format('select public.reserve_ai_provider_attempt(%L,%L,%L,%L,%L,%L,%L)',
 r.user_id,r.id,'attempt-'||n,provider,coalesce(model,case when paid then 'anthropic/claude-haiku-5.5' else 'apodex/apodex-1.1-mini:free' end),amount,paid));
end; $$;
create function pg_temp.settle(n integer,status text,cost bigint,provider_id text default null,tokens bigint default null)
returns jsonb language plpgsql as $$
declare r record; attempt uuid;
begin
 select * into r from ai_budget_requests where ai_budget_requests.n=settle.n;
 select id into attempt from app_private.ai_provider_attempts where request_id=r.id;
 return pg_temp.provider_command(format('select public.settle_ai_provider_attempt(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
 r.user_id,r.id,attempt,provider_id,status,tokens,tokens,tokens,cost));
end; $$;

select ok(not has_function_privilege('authenticated','public.reserve_ai_provider_attempt(uuid,uuid,text,text,text,bigint,boolean)','EXECUTE'),'browser cannot reserve a provider attempt');
select ok(not has_function_privilege('anon','public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint,bigint,text)','EXECUTE'),'anonymous cannot settle provider usage');
select ok(not has_table_privilege('service_role','app_private.ai_provider_budget','UPDATE'),'service role cannot enable paid execution by direct table write');
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname like 'ai_provider_%' and c.relrowsecurity and c.relforcerowsecurity),4::bigint,'all four provider ledger tables force RLS');
select throws_ok($$select pg_temp.reserve(1,true,100)$$,'42501','AI_PAID_EXECUTION_NOT_AUTHORIZED','paid execution starts disabled');
select throws_ok($$select pg_temp.reserve(1,false,0)$$,'55000','AI_OPENROUTER_FREE_ADMISSION_REQUIRED','OpenRouter free attempt requires its separate admission');
select is(pg_temp.provider_command(format('select public.admit_openrouter_free_request(%L,%L,1,100)',id,user_id))->>'replay','false','first free admission is new') from ai_budget_requests where n=1;
select is(pg_temp.provider_command(format('select public.admit_openrouter_free_request(%L,%L,1,100)',id,user_id))->>'replay','true','free admission replay does not consume another call') from ai_budget_requests where n=1;
select throws_ok(format('select pg_temp.provider_command(%L)',format('select public.admit_openrouter_free_request(%L,%L,1,100)',id,user_id)),'P0001','AI_OPENROUTER_FREE_RATE_LIMITED_MINUTE','separate free minute counter rejects the next request') from ai_budget_requests where n=2;
select throws_ok($$select pg_temp.reserve(1,false,0,'openrouter','unknown/model:free')$$,'22023','AI_PROVIDER_ATTEMPT_INVALID','a free suffix cannot bypass the exact approved model');
select is(pg_temp.reserve(1,false,0)->>'status','RESERVED','approved free provider attempt is reserved');
select is(pg_temp.reserve(1,false,0)->>'replay','true','attempt retry restores the original attempt and must not send again');
select is(pg_temp.settle(1,'DISPATCHED',null)->>'replay','false','first dispatch records its fence before external sending');
select is(pg_temp.settle(1,'DISPATCHED',null)->>'replay','true','dispatch replay is fenced');
select throws_ok($$select pg_temp.settle(1,'SUCCEEDED',1,'free-id',10)$$,'55000','AI_FREE_PROVIDER_REPORTED_PAID_COST','free evidence cannot hide a paid provider charge');
select is(pg_temp.settle(1,'SUCCEEDED',0,'free-id',10)->>'chargedCostMicroUsd','0','reported free success stores exact zero cost');
select is(pg_temp.settle(1,'SUCCEEDED',0,'free-id',10)->>'replay','true','settlement replay is idempotent');
select throws_ok($$select pg_temp.settle(1,'SUCCEEDED',0,'free-id',11)$$,'55000','AI_PROVIDER_ATTEMPT_TRANSITION_INVALID','a settled evidence record cannot be changed');
select is(pg_temp.reserve(2,false,0,'nvidia','openai/gpt-oss-20b')->>'status','RESERVED','NVIDIA uses its own free provider lane');
select throws_ok($$select pg_temp.reserve(2,false,0,'nvidia','google/diffusiongemma-26b-a4b-it')$$,'55000','AI_PROVIDER_ATTEMPT_REPLAY_MISMATCH','attempt replay cannot change models');

-- Test-only authorization is rolled back at the end of this file.
update app_private.ai_provider_budget set paid_enabled=true,authorization_reference='PGTAP_ONLY_NO_PROVIDER_EXECUTION';
insert into app_private.ai_provider_member_limits values
 ('aa000000-0000-4000-8000-000000000001',10000000,'PGTAP_ONLY_NO_PROVIDER_EXECUTION'),
 ('aa000000-0000-4000-8000-000000000002',1000000,'PGTAP_ONLY_NO_PROVIDER_EXECUTION');
select is(pg_temp.reserve(3,true,6000000)->>'reservedCostMicroUsd','6000000','paid budget reservation uses exact integer micro USD');
select is(pg_temp.settle(3,'DISPATCHED',null)->>'status','DISPATCHED','paid dispatch fence is recorded');
select is(pg_temp.settle(3,'UNKNOWN',null,'unknown-id',20)->>'chargedCostMicroUsd',null,'unknown provider cost stays unknown');
select is((select reserved_micro_usd from app_private.ai_provider_budget),6000000::bigint,'unknown provider outcomes retain their full reservation');
select throws_ok($$select pg_temp.reserve(4,true,5000000)$$,'P0001','AI_PAID_BUDGET_EXHAUSTED','cumulative spent plus unknown reservation rejects budget overrun');
select is(pg_temp.reserve(4,true,4000000)->>'status','RESERVED','exact remaining global budget can be reserved');
select is((select reserved_micro_usd from app_private.ai_provider_budget),10000000::bigint,'reservations reach the exact USD 10 ceiling');
select throws_ok($$select pg_temp.reserve(5,true,1)$$,'P0001','AI_PAID_BUDGET_EXHAUSTED','no extra micro USD is admitted above the ceiling');
select is(pg_temp.settle(4,'NOT_SENT',0)->>'status','NOT_SENT','a never-dispatched request releases its reservation');
select is((select reserved_micro_usd from app_private.ai_provider_budget),6000000::bigint,'only the never-sent reservation is returned');
select throws_ok($$select pg_temp.settle(3,'SUCCEEDED',3000000,'changed-id',20)$$,'55000','AI_PROVIDER_EVIDENCE_IMMUTABLE','provider identity cannot change during reconciliation');
select is(pg_temp.settle(3,'SUCCEEDED',3000000,'unknown-id',20)->>'chargedCostMicroUsd','3000000','verified terminal usage replaces unknown cost with the actual amount');
select ok((select spent_micro_usd=3000000 and reserved_micro_usd=0 from app_private.ai_provider_budget),'settlement atomically spends actual usage and releases its reserved maximum');
select is(pg_temp.reserve(5,true,7000000)->>'status','RESERVED','spent plus reserved may equal the cap');
select is(pg_temp.settle(5,'DISPATCHED',null)->>'status','DISPATCHED','second paid dispatch records its own fence');
select is(pg_temp.settle(5,'CANCELLED',null)->>'chargedCostMicroUsd',null,'cancellation after dispatch cannot invent zero cost');
select is((select reserved_micro_usd from app_private.ai_provider_budget),7000000::bigint,'unpriced cancellation retains budget');
select throws_ok($$select pg_temp.reserve(6,true,1)$$,'P0001','AI_PAID_BUDGET_EXHAUSTED','cancellation does not reset cumulative spend');
select is(pg_temp.settle(5,'CANCELLED',1000000)->>'chargedCostMicroUsd','1000000','late reported cancellation usage is reconciled honestly');
select ok((select spent_micro_usd=4000000 and reserved_micro_usd=0 from app_private.ai_provider_budget),'late reconciliation preserves previous cumulative spend');
select throws_ok($$select pg_temp.reserve(13,true,1000001)$$,'P0001','AI_PAID_BUDGET_EXHAUSTED','per-member authorized paid cap is also enforced');
select throws_ok(format('select pg_temp.provider_command(%L)',format('select public.reserve_ai_provider_attempt(%L,%L,%L,%L,%L,0,false)','aa000000-0000-4000-8000-000000000002',id,'owner-check','nvidia','openai/gpt-oss-20b')),'42501','AI_REQUEST_NOT_OWNED','a provider attempt cannot bind another member request') from ai_budget_requests where n=2;
select is(pg_temp.provider_command('select public.read_ai_provider_usage(''aa000000-0000-4000-8000-000000000001'')')->'free'->>'costMicroUsd','0','member usage reads the exact free cost');
select is(pg_temp.provider_command('select public.read_ai_provider_usage(''aa000000-0000-4000-8000-000000000001'')')->'paid'->>'costMicroUsd','4000000','member usage retains all cumulative actual paid cost');
select is((select count(*) from app_private.ai_openrouter_free_admissions),1::bigint,'paid/NVIDIA attempts do not consume OpenRouter free admission counters');
select * from finish();
rollback;
