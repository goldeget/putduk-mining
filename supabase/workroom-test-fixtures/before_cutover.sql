-- Run after committed historical financial fixtures and real GoTrue old-member
-- creation, before migration202. No identity or money row is synthesized here.
begin;
create schema workroom_native_evidence;
revoke all on schema workroom_native_evidence from public,anon,authenticated,service_role;
create table workroom_native_evidence.rows(schema_name text,table_name text,row_count bigint,digest text,primary key(schema_name,table_name));
create table workroom_native_evidence.definers as
select p.oid object_oid,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,
 pg_get_userbyid(p.proowner) owner_name,pg_get_function_result(p.oid) result_type,p.proconfig,
 coalesce(p.proacl,acldefault('f',p.proowner))::text acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in('public','app_private') and p.prosecdef;
create table workroom_native_evidence.member_login as
select pg_get_functiondef(p.oid) definition,coalesce(p.proacl,acldefault('f',p.proowner))::text acl
from pg_proc p where p.oid='public.resolve_login_email(text)'::regprocedure;
do $$declare t record;c bigint;d text;begin
 if(select count(*) from workroom_native_evidence.definers)<>84 then raise exception 'WORKROOM_BASELINE_EXACT_84_REQUIRED';end if;
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in('r','p') and (n.nspname in('public','app_private') or(n.nspname='auth' and c.relname in('users','identities'))) order by 1,2 loop
 execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),''''),''UTF8'')),''hex'') from %I.%I t',t.nspname,t.relname) into c,d;
 insert into workroom_native_evidence.rows values(t.nspname,t.relname,c,d);
 end loop;
 if not exists(select 1 from auth.users) then raise exception 'WORKROOM_PREEXISTING_IDENTITIES_REQUIRED';end if;
end$$;
commit;
