begin;
do $$declare t record;c bigint;d text;f record;oid_now oid;
 retired text[]:=array['public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)','public.start_trial(uuid,text)','public.participate_published_event(uuid,uuid,uuid,uuid)','public.participate_published_event(uuid,uuid,uuid,uuid,text)','app_private.participate_published_event(uuid,uuid,uuid,uuid)','app_private.participate_published_event(uuid,uuid,uuid,uuid,text)'];
 additions text[]:=array['app_private.workroom_signup()','public.workroom_read_state()','public.workroom_member_command(text,text,jsonb)','public.workroom_admin_command(text,text,jsonb,uuid,uuid,text,text)','app_private.resolve_operator_login_email(text)'];
begin
 for t in select * from workroom_native_evidence.rows loop
 execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),''''),''UTF8'')),''hex'') from %I.%I t',t.schema_name,t.table_name) into c,d;
 if c<>t.row_count or d<>t.digest then raise exception 'WORKROOM_HISTORICAL_ROW_CHANGED %.%',t.schema_name,t.table_name;end if;
 end loop;
 if exists(select id from auth.users except select user_id from app_private.workroom_cohort)
 or exists(select user_id from app_private.workroom_cohort except select id from auth.users) then raise exception 'WORKROOM_COHORT_EXACT_IDENTITY_REQUIRED';end if;
 for f in select * from workroom_native_evidence.definers loop
 oid_now:=to_regprocedure(f.signature);
 if oid_now is null or pg_get_functiondef(oid_now)<>f.definition or pg_get_function_result(oid_now)<>f.result_type
 or not exists(select 1 from pg_proc p where p.oid=oid_now and pg_get_userbyid(p.proowner)=f.owner_name and p.proconfig is not distinct from f.proconfig and p.prosecdef) then raise exception 'WORKROOM_HISTORICAL_SECDEF_CHANGED %',f.signature;end if;
 if f.signature<>all(retired) and not exists(select 1 from pg_proc p where p.oid=oid_now and coalesce(p.proacl,acldefault('f',p.proowner))::text=f.acl) then raise exception 'WORKROOM_HISTORICAL_ACL_CHANGED %',f.signature;end if;
 if f.signature=any(retired) and
 (select coalesce(jsonb_agg(to_jsonb(a) order by a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb) from aclexplode(f.acl::aclitem[])a where a.grantee<>all(array[0::oid,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid]))
 is distinct from
 (select coalesce(jsonb_agg(to_jsonb(a) order by a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb) from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where p.oid=oid_now)
 then raise exception 'WORKROOM_RETIREMENT_UNREVIEWED_ACL_CHANGE %',f.signature;end if;
 end loop;
 if(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prosecdef)<>89 then raise exception 'WORKROOM_EXACT_89_REQUIRED';end if;
 if exists(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prosecdef and not exists(select 1 from workroom_native_evidence.definers d where to_regprocedure(d.signature)=p.oid) and p.oid<>all(array(select to_regprocedure(s)::oid from unnest(additions)s))) then raise exception 'WORKROOM_UNREVIEWED_SECDEF';end if;
 foreach d in array additions loop
 oid_now:=to_regprocedure(d);
 if not exists(select 1 from pg_proc p where p.oid=oid_now and p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array['search_path=pg_catalog']::text[] and pg_get_function_result(p.oid)=case when d='app_private.workroom_signup()' then 'trigger' when d='app_private.resolve_operator_login_email(text)' then 'text' else 'jsonb' end) then raise exception 'WORKROOM_NEW_SECDEF_CONTRACT %',d;end if;
 if has_function_privilege('anon',oid_now,'execute') or has_function_privilege('service_role',oid_now,'execute')<>(d='app_private.resolve_operator_login_email(text)') or exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where p.oid=oid_now and a.grantee=0 and a.privilege_type='EXECUTE') or has_function_privilege('authenticated',oid_now,'execute')<>(d not in('app_private.workroom_signup()','app_private.resolve_operator_login_email(text)')) then raise exception 'WORKROOM_NEW_SECDEF_ACL %',d;end if;
 end loop;
 foreach d in array retired loop
 oid_now:=to_regprocedure(d);if oid_now is not null and(has_function_privilege('anon',oid_now,'execute') or has_function_privilege('authenticated',oid_now,'execute') or has_function_privilege('service_role',oid_now,'execute')) then raise exception 'WORKROOM_RETIREMENT_ACL %',d;end if;
 end loop;
end$$;
commit;
