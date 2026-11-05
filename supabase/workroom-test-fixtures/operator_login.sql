-- Owner-only, rollback-native fixtures. Alias metadata is never role authority.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok((select p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array['search_path=pg_catalog']::text[] from pg_proc p where p.oid='app_private.resolve_operator_login_email(text)'::regprocedure)
 and (select not p.prosecdef and p.proconfig=array['search_path=pg_catalog']::text[] from pg_proc p where p.oid='public.resolve_operator_login_email(text)'::regprocedure),'private fixed-path definer and public invoker keep one narrow service entrypoint');
select ok(has_function_privilege('service_role','public.resolve_operator_login_email(text)','EXECUTE')
 and has_function_privilege('service_role','app_private.resolve_operator_login_email(text)','EXECUTE')
 and not has_function_privilege('authenticated','public.resolve_operator_login_email(text)','EXECUTE')
 and not has_function_privilege('anon','public.resolve_operator_login_email(text)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.resolve_operator_login_email(text)','EXECUTE')
 and not has_function_privilege('anon','app_private.resolve_operator_login_email(text)','EXECUTE')
 and not exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where p.oid in('public.resolve_operator_login_email(text)'::regprocedure,'app_private.resolve_operator_login_email(text)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'),'both resolver layers deny public/member/anon and allow only service execution');
select ok(exists(select 1 from workroom_native_evidence.member_login old join pg_proc p on p.oid='public.resolve_login_email(text)'::regprocedure where old.definition=pg_get_functiondef(p.oid) and old.acl=coalesce(p.proacl,acldefault('f',p.proowner))::text),'ordinary member login resolver definition and privileges are byte-identical to201');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
values('0a900000-0000-4000-8000-000000000001','operator-proof-a@example.test',clock_timestamp(),app_private.workroom_native_signup_metadata('{"operator_login_id":"Wr_Native_Operator_Probe","role":"SUPER_ADMIN"}')),
('0a900000-0000-4000-8000-000000000002','operator-proof-b@example.test',clock_timestamp(),app_private.workroom_native_signup_metadata('{"operator_login_id":" wr_native_operator_probe "}'));
set local role service_role;
select is(public.resolve_operator_login_email('wr_native_operator_probe'),null::text,'forged role metadata with no real operator role never resolves');
select throws_ok($q$select public.resolve_operator_login_email('x@example.test')$q$,'22023','OPERATOR_LOGIN_ID_INVALID','email-shaped identifier is rejected by alias-only resolver');
select throws_ok($q$select public.resolve_operator_login_email(null)$q$,'22023','OPERATOR_LOGIN_ID_INVALID','null alias fails closed');
reset role;
insert into public.user_roles(user_id,role,granted_by) values('0a900000-0000-4000-8000-000000000001','SUPER_ADMIN','0a900000-0000-4000-8000-000000000001');
set local role service_role;
select is(public.resolve_operator_login_email('  WR_NATIVE_OPERATOR_PROBE  '),'operator-proof-a@example.test','real SUPER_ADMIN role resolves normalized operator ID');
reset role;
update public.user_roles set revoked_at=clock_timestamp() where user_id='0a900000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.resolve_operator_login_email('wr_native_operator_probe'),null::text,'revoked historical operator role cannot resolve');
reset role;
update public.user_roles set revoked_at=null where user_id='0a900000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role,granted_by) values('0a900000-0000-4000-8000-000000000002','ADMIN','0a900000-0000-4000-8000-000000000001');
set local role service_role;
select throws_ok($q$select public.resolve_operator_login_email('wr_native_operator_probe')$q$,'23505','OPERATOR_LOGIN_ID_AMBIGUOUS','duplicate eligible operator aliases error rather than choose a principal');
reset role;
delete from public.user_roles where user_id='0a900000-0000-4000-8000-000000000002';
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='0a900000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.resolve_operator_login_email('wr_native_operator_probe'),null::text,'banned operator cannot resolve');
reset role;
update auth.users set banned_until=null,deleted_at=clock_timestamp() where id='0a900000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.resolve_operator_login_email('wr_native_operator_probe'),null::text,'deleted operator cannot resolve');
reset role;
update auth.users set deleted_at=null,email_confirmed_at=null where id='0a900000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.resolve_operator_login_email('wr_native_operator_probe'),null::text,'unconfirmed operator cannot resolve');
reset role;
update auth.users set email_confirmed_at=clock_timestamp(),is_anonymous=true where id='0a900000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.resolve_operator_login_email('wr_native_operator_probe'),null::text,'anonymous principal cannot resolve even with operator role');
reset role;
set local role authenticated;
select throws_ok($q$select public.resolve_operator_login_email('wr_native_operator_probe')$q$,'42501','permission denied for function resolve_operator_login_email','member cannot invoke server-only alias resolution');
reset role;
select * from finish();
rollback;
