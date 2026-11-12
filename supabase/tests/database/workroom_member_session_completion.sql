begin;
select extensions.plan(5);
create function pg_temp.completion_must_fail(statement text, expected text) returns void language plpgsql as $$
begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise exception 'Expected %, got %',expected,sqlerrm;end;
 raise exception 'Expected failure: %',expected;
end$$;
grant execute on function pg_temp.completion_must_fail(text,text) to service_role;

do $$begin
 if has_function_privilege('anon','public.complete_workroom_birth_digit(uuid,text,uuid)','EXECUTE') or has_function_privilege('authenticated','public.complete_workroom_birth_digit(uuid,text,uuid)','EXECUTE') then raise exception 'Completion RPC exposed to direct clients';end if;
 if has_column_privilege('authenticated','public.user_identity_profiles','birth_sex_digit','UPDATE') then raise exception 'Member can directly overwrite identity';end if;
 if has_function_privilege('authenticated','app_private.workroom_admin_member_history(jsonb)','EXECUTE') or has_function_privilege('service_role','app_private.workroom_admin_member_history(jsonb)','EXECUTE') then raise exception 'Unchecked private history exposed';end if;
end$$;
select extensions.ok(true,'completion RPC and identity writes remain server-only');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select ('12660000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','member-completion-'||n||'@putduk.test','',now(),'{"provider":"email","providers":["email"]}',
 app_private.workroom_native_signup_metadata(jsonb_build_object('signup_source','PUBLIC_V1','legal_name','검증회원','login_id','completion_native_'||n,'date_of_birth','1990-01-01','birth_sex_digit','1','phone_e164','+82109900126'||n,'recovery_email','member-completion-'||n||'@putduk.test','service_terms_version','TERMS-KO-2026-09-27','privacy_version','PRIVACY-KO-2026-09-27','marketing_version','MARKETING-KO-2026-09-27','service_terms_granted',true,'privacy_granted',true,'marketing_granted',false)),now(),now(),'','','',''
from generate_series(1,2)n;
update public.user_identity_profiles set birth_sex_digit=null where user_id='12660000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin
 perform pg_temp.completion_must_fail($q$select public.complete_workroom_birth_digit('12660000-0000-4000-8000-000000000001','3','12660000-0000-4000-8000-000000000010')$q$,'BIRTH_DIGIT_CENTURY_MISMATCH');
 perform pg_temp.completion_must_fail($q$select public.complete_workroom_birth_digit('12660000-0000-4000-8000-000000000001','2123456','12660000-0000-4000-8000-000000000011')$q$,'INVALID_BIRTH_DIGIT');
 perform public.complete_workroom_birth_digit('12660000-0000-4000-8000-000000000001','2','12660000-0000-4000-8000-000000000012');
 perform public.complete_workroom_birth_digit('12660000-0000-4000-8000-000000000001','2','12660000-0000-4000-8000-000000000013');
 perform pg_temp.completion_must_fail($q$select public.complete_workroom_birth_digit('12660000-0000-4000-8000-000000000001','1','12660000-0000-4000-8000-000000000014')$q$,'BIRTH_DIGIT_ALREADY_RECORDED');
 if not exists(select 1 from public.user_identity_profiles where user_id='12660000-0000-4000-8000-000000000001' and birth_sex_digit='2' and date_of_birth='1990-01-01') then raise exception 'Completion did not preserve birth date';end if;
 if not exists(select 1 from public.user_identity_profiles where user_id='12660000-0000-4000-8000-000000000002' and birth_sex_digit='1') then raise exception 'Another identity changed';end if;
 if (select count(*) from public.audit_logs where target_id='12660000-0000-4000-8000-000000000001' and action='MEMBER_BIRTH_DIGIT_COMPLETED')<>1 then raise exception 'Completion audit not atomic/idempotent';end if;
end$$;
reset role;
select extensions.ok(true,'missing digit completion validates century, preserves other identities and audits exactly once');

insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
values('12660000-0000-4000-8000-000000000020','12660000-0000-4000-8000-000000000001','completion-auth-native','completion-native',statement_timestamp()+interval '2 hours',statement_timestamp()+interval '12 hours');
create temporary table completion_expected_deadlines as select idle_expires_at,absolute_expires_at from public.admin_sessions where id='12660000-0000-4000-8000-000000000020';
set local role service_role;
select public.issue_admin_step_up('12660000-0000-4000-8000-000000000020','12660000-0000-4000-8000-000000000001','DEPOSIT_INSTRUCTION',repeat('b',48),600);
reset role;
select extensions.ok((select s.idle_expires_at=e.idle_expires_at and s.absolute_expires_at=e.absolute_expires_at from public.admin_sessions s cross join completion_expected_deadlines e where s.id='12660000-0000-4000-8000-000000000020'),'sensitive action confirmation never shortens the extended session or extends its absolute bound');
update public.admin_sessions set idle_expires_at=statement_timestamp()-interval '1 minute',created_at=statement_timestamp()-interval '2 hours' where id='12660000-0000-4000-8000-000000000020';
set local role service_role;
select pg_temp.completion_must_fail($q$select public.assert_admin_session('12660000-0000-4000-8000-000000000001','completion-auth-native','completion-native',7200)$q$,'ADMIN_SESSION_IDLE_EXPIRED');
reset role;
select extensions.ok(true,'activity refresh cannot revive an expired session');

-- Disposable display fixtures verify every page, without touching real cash ledgers.
insert into app_private.workroom_rounds(user_id,instrument,stake,snapshot,started_at,closed_at,returned)
select '12660000-0000-4000-8000-000000000001','nvda',1000,jsonb_build_object('roi',5,'pattern','slow','duration',300,'amplitude',6,'version',1),now()-make_interval(secs=>n*60),now()-make_interval(secs=>n*60-30),1050 from generate_series(1,26)n;
insert into app_private.workroom_ledger(user_id,amount,balance_after,kind,note)
select '12660000-0000-4000-8000-000000000001',1,100000+n,'ADJUSTMENT','폐기형 조회 검증' from generate_series(1,26)n;
do $$declare a jsonb;b jsonb;c jsonb;begin
 a:=app_private.workroom_admin_member_history('{"userId":"12660000-0000-4000-8000-000000000001","roundPage":1,"pointPage":1}');
 b:=app_private.workroom_admin_member_history('{"userId":"12660000-0000-4000-8000-000000000001","roundPage":2,"pointPage":2}');
 c:=app_private.workroom_admin_member_history('{"userId":"12660000-0000-4000-8000-000000000002","roundPage":1,"pointPage":1}');
 if a->>'roundCount'<>'26' or a->>'ledgerCount'<>'27' or jsonb_array_length(a->'rounds')<>25 or jsonb_array_length(b->'rounds')<>1 or jsonb_array_length(a->'ledger')<>25 or jsonb_array_length(b->'ledger')<>2 then raise exception 'Incomplete history pagination';end if;
 if a->'rounds'->0->>'stake'<>'1000' or a->'rounds'->0->>'returned'<>'1050' or a->'rounds'->0->>'profit'<>'50' then raise exception 'Returned principal confused with profit';end if;
 if c->>'roundCount'<>'0' or c->>'ledgerCount'<>'1' then raise exception 'Member histories mixed';end if;
 if exists(select 1 from jsonb_array_elements(a->'rounds') x join jsonb_array_elements(b->'rounds') y on x->>'id'=y->>'id') then raise exception 'Round pagination duplicates';end if;
end$$;
select extensions.ok(true,'all history pages are target-bound and distinguish stake, returned points and profit');
select * from extensions.finish();
rollback;
