-- Finance owner registers/executes after reviewing fixtures against exact local Auth schema.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Shared rollback-only fixtures for native CMS/Admin AI pgTAP owner review.
-- Include after BEGIN/no_plan(). No production credentials or monetary budget.
create temporary table recovery_admin_ctx(actor uuid,admin_session uuid,auth_session uuid,factor uuid,ordinary_admin uuid,
 member_a uuid,member_b uuid,conversation_a uuid,conversation_b uuid);
insert into recovery_admin_ctx values('38500000-0000-4000-8000-000000000001','38500000-0000-4000-8000-000000000002',
 '38500000-0000-4000-8000-000000000003','38500000-0000-4000-8000-000000000004','38500000-0000-4000-8000-000000000005',
 '38500000-0000-4000-8000-000000000006','38500000-0000-4000-8000-000000000007','38500000-0000-4000-8000-000000000008','38500000-0000-4000-8000-000000000009');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select id,'authenticated','authenticated',id::text||'@recovery.putduk.test','',statement_timestamp(),'{}','{}',
 statement_timestamp(),statement_timestamp(),'','','','' from recovery_admin_ctx cross join lateral unnest(array[actor,ordinary_admin,member_a,member_b])id;
insert into public.user_roles(user_id,role,granted_by) select actor,'SUPER_ADMIN'::public.app_role,actor from recovery_admin_ctx
 union all select ordinary_admin,'ADMIN'::public.app_role,actor from recovery_admin_ctx;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
select factor,actor,'rollback-test-totp','totp','verified',clock_timestamp(),clock_timestamp(),'ROLLBACK_ONLY_SECRET' from recovery_admin_ctx;
insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal,not_after)
select auth_session,actor,clock_timestamp(),clock_timestamp(),factor,'aal2',clock_timestamp()+interval '2 hours' from recovery_admin_ctx;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),auth_session,clock_timestamp(),clock_timestamp(),'totp' from recovery_admin_ctx;
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
select admin_session,actor,auth_session::text,'putduk-native-recovery-fixture',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours' from recovery_admin_ctx;
grant select,update on recovery_admin_ctx to service_role;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

insert into public.ai_conversations(id,user_id,title_text) select conversation_a,member_a,'원문 상담 A' from recovery_admin_ctx
 union all select conversation_b,member_b,'원문 상담 B' from recovery_admin_ctx;
insert into public.ai_messages(id,conversation_id,user_id,author_role,body_text,position,client_message_id)
 select gen_random_uuid(),conversation_a,member_a,'MEMBER','원금 일부를 보류했어요. 100만 원 중 30만 원 취소 후 날짜는 유지되나요?',1,gen_random_uuid() from recovery_admin_ctx
 union all select gen_random_uuid(),conversation_a,member_a,'ASSISTANT','보류된 부분의 기간만 잠시 멈추고, 이미 지난 기간은 유지합니다.',2,null from recovery_admin_ctx
 union all select gen_random_uuid(),conversation_b,member_b,'MEMBER','다른 회원의 원문 질문',1,gen_random_uuid() from recovery_admin_ctx;
create function pg_temp.recovery_admin_read(p_operation text,p_input jsonb,p_actor uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select public.admin_read_ai_conversations(coalesce(p_actor,actor),admin_session,gen_random_uuid(),p_operation,p_input) from pg_temp.recovery_admin_ctx;
$$;
grant execute on function pg_temp.recovery_admin_read(text,jsonb,uuid) to service_role;
select ok(not has_function_privilege('anon','public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb)','EXECUTE'),'full transcript RPC is not a browser read grant');
set local role service_role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.recovery_admin_read('LIST','{}')$$,'42501',null,'crossed service SQL role/member JWT cannot read transcripts');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.recovery_admin_read('MESSAGES',jsonb_build_object('operation','MESSAGES','userId',member_a,'conversationId',conversation_a,'afterPosition',0,'limit',1))#>>'{data,messages,0,bodyText}',
 '원금 일부를 보류했어요. 100만 원 중 30만 원 취소 후 날짜는 유지되나요?','current bound SUPER_ADMIN gets full original question') from recovery_admin_ctx;
select is(pg_temp.recovery_admin_read('MESSAGES',jsonb_build_object('userId',member_a,'conversationId',conversation_a,'afterPosition',1,'limit',1))#>>'{data,messages,0,position}','2','stable position continuation gets actual second message') from recovery_admin_ctx;
select is(pg_temp.recovery_admin_read('MESSAGES',jsonb_build_object('userId',member_b,'conversationId',conversation_a)) ->>'code','NOT_FOUND','cross-member conversation tuple denied') from recovery_admin_ctx;
select is(pg_temp.recovery_admin_read('LIST',jsonb_build_object('userId',member_a,'limit',1))#>>'{data,conversations,0,userId}',member_a::text,'member filter limits the returned private scope') from recovery_admin_ctx;
select is(pg_temp.recovery_admin_read('SEARCH','{"kind":"TEXT","value":"original private text"}',ordinary_admin)->>'code','ROLE_FORBIDDEN','ordinary ADMIN does not inherit transcript authority') from recovery_admin_ctx;
select is(pg_temp.recovery_admin_read('MESSAGES','{"limit":1000}')->>'code','INVALID_INPUT','page overflow does not read arbitrary private rows');
reset role;
select ok(exists(select 1 from public.audit_logs where action='ADMIN_AI_CONVERSATION_READ' and actor_user_id=(select actor from recovery_admin_ctx)),'successful reads have their real access audit');
select ok(not exists(select 1 from public.audit_logs where action in ('ADMIN_AI_CONVERSATION_READ','ADMIN_AI_READ_DENIED') and metadata::text like '%original private text%'),'neither success nor denial audits store original search/transcript input');
update public.admin_sessions set revoked_at=clock_timestamp(),revoke_reason='rollback fixture revocation' where id=(select admin_session from recovery_admin_ctx);
set local role service_role;
select is(pg_temp.recovery_admin_read('LIST','{}')->>'code','ADMIN_SESSION_REVOKED','session revocation denies the next read despite previous success');
reset role;
update public.admin_sessions set revoked_at=null where id=(select admin_session from recovery_admin_ctx);
update auth.sessions set aal='aal1' where id=(select auth_session from recovery_admin_ctx);
set local role service_role;
select is(pg_temp.recovery_admin_read('LIST','{}')->>'code','ADMIN_SESSION_REQUIRED','forged application AAL2 cannot replace the actual Auth session assurance');
reset role;
update auth.sessions set aal='aal2' where id=(select auth_session from recovery_admin_ctx);
update auth.mfa_factors set status='unverified' where id=(select factor from recovery_admin_ctx);
set local role service_role;
select is(pg_temp.recovery_admin_read('LIST','{}')->>'code','ADMIN_SESSION_REQUIRED','an unverified bound factor denies full transcript');
reset role;
update auth.mfa_factors set status='verified' where id=(select factor from recovery_admin_ctx);
delete from auth.mfa_amr_claims where session_id=(select auth_session from recovery_admin_ctx);
set local role service_role;
select is(pg_temp.recovery_admin_read('LIST','{}')->>'code','ADMIN_SESSION_REQUIRED','factor existence alone cannot replace this session TOTP AMR proof');
reset role;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) select gen_random_uuid(),auth_session,clock_timestamp(),clock_timestamp(),'totp' from recovery_admin_ctx;
update public.user_roles set revoked_at=clock_timestamp() where user_id=(select actor from recovery_admin_ctx) and role='SUPER_ADMIN';
set local role service_role;
select is(pg_temp.recovery_admin_read('LIST','{}')->>'code','ROLE_FORBIDDEN','current role revocation defeats an earlier access receipt');
reset role;
reset role;
update public.user_roles set revoked_at=null where user_id=(select actor from recovery_admin_ctx) and role='SUPER_ADMIN';
create function pg_temp.reject_admin_read_audit()returns trigger language plpgsql as $$begin
 if new.action='ADMIN_AI_CONVERSATION_READ' then raise exception 'FIXTURE_AUDIT_REJECTED';end if;return new;end;$$;
create trigger recovery_test_admin_audit_failure before insert on public.audit_logs for each row execute function pg_temp.reject_admin_read_audit();
set local role service_role;
select is(pg_temp.recovery_admin_read('MESSAGES',jsonb_build_object('userId',member_a,'conversationId',conversation_a)) ->>'code','READ_UNAVAILABLE','failed successful-read audit returns no private data envelope') from recovery_admin_ctx;
reset role;drop trigger recovery_test_admin_audit_failure on public.audit_logs;
select * from finish();rollback;
