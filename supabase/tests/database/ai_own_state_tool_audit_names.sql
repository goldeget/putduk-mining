begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
values('10639200-0000-4000-8000-000000000001','authenticated','authenticated','local-own-tool-audit@putduk.test','',now(),'{}','{}',now(),now(),'','','','');
create temporary table tool_requests(tool text,id uuid);
grant select,insert on tool_requests to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into tool_requests select t,request_id from unnest(array['ai.usage','ai.cancelled_history','wallet.summary']) t
cross join lateral public.begin_ai_request_v2('10639200-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),'{}','local-static','local-recovery',5,100,'tool','account_read','ACCOUNT_STATE','ACCOUNT_STATE',t);
select is((select count(*) from tool_requests),3::bigint,'two approved own-state tools and the existing wallet tool use canonical admission');
select is((select count(*) from public.ai_requests where id in(select id from tool_requests) and tool_name in('ai.usage','ai.cancelled_history')),2::bigint,'new own-state names are durably audited as read-only tools');
select throws_like($$select public.begin_ai_request_v2('10639200-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),'{}','local-static','local-recovery',5,100,'tool','account_read','ACCOUNT_STATE','ACCOUNT_STATE','ai.money_write')$$,
 '%','unapproved money tool name is refused');
reset role;
select ok(not has_function_privilege('anon','public.begin_ai_request_v2(uuid,uuid,text,jsonb,text,text,integer,integer,text,text,text,text,text)','EXECUTE'),'anon cannot forge own-state tool admission');
select ok(not has_function_privilege('authenticated','public.begin_ai_request_v2(uuid,uuid,text,jsonb,text,text,integer,integer,text,text,text,text,text)','EXECUTE'),'member cannot forge own-state tool admission');
select * from finish();rollback;
