begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);
create function pg_temp.bank_must_fail(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise exception 'Expected %, got %',expected,sqlerrm;end;
 raise exception 'Expected failure: %',expected;
end$$;
grant execute on function pg_temp.bank_must_fail(text,text) to service_role;
do $$declare signature text:='public.set_krw_deposit_settings(uuid,uuid,text,text,uuid,integer,text,text,text,text,text,text)';begin
 if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') then raise exception 'Member can change receiving account';end if;
 if has_table_privilege('authenticated','public.member_registration_context','SELECT') or has_table_privilege('anon','public.krw_deposit_settings','SELECT') or has_table_privilege('authenticated','public.krw_deposit_settings','UPDATE') then raise exception 'Sensitive signup or instruction ACL exposed';end if;
end$$;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
values('11660000-0000-4000-8000-000000000001','authenticated','authenticated','bank-admin@putduk.test','',now(),'{}',app_private.workroom_native_signup_metadata('{}'),now(),now(),'','','','');
insert into public.user_roles(user_id,role,granted_by)values('11660000-0000-4000-8000-000000000001','ADMIN','11660000-0000-4000-8000-000000000001');
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
values('11660000-0000-4000-8000-000000000002','11660000-0000-4000-8000-000000000001','bank-auth-native','bank-native',now()+interval '30 minutes',now()+interval '1 hour');
insert into public.admin_step_up_grants(admin_session_id,user_id,command_family,token_hash,expires_at,consumed_at,consume_request_id)
select '11660000-0000-4000-8000-000000000002','11660000-0000-4000-8000-000000000001','DEPOSIT_INSTRUCTION','bank-native-'||n,now()+interval '10 minutes',now(),('11660000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(10,15)n;
set local role service_role;
do $$declare a uuid:='11660000-0000-4000-8000-000000000001';s uuid:='11660000-0000-4000-8000-000000000002';v integer;begin
 select version into v from public.krw_deposit_settings where id;
 perform public.set_krw_deposit_settings(a,s,'bank-auth-native','aal2','11660000-0000-4000-8000-000000000010',v,'ACCOUNT','테스트은행','123-45678901','검증회사','상담 후 안내','폐기형 환경 계좌 표시 검증');
 if not exists(select 1 from public.krw_deposit_settings where mode='ACCOUNT' and account_number='123-45678901' and version=v+1) then raise exception 'Account not published';end if;
 perform pg_temp.bank_must_fail(format($q$select public.set_krw_deposit_settings(%L,%L,'bank-auth-native','aal2','11660000-0000-4000-8000-000000000011',%s,'CONTACT','','','','상담 후 안내','폐기형 환경 오래된 수정 검증')$q$,a,s,v),'KRW_INSTRUCTION_STALE');
 perform pg_temp.bank_must_fail(format($q$select public.set_krw_deposit_settings(%L,%L,'bank-auth-native','aal2','11660000-0000-4000-8000-000000000099',%s,'CONTACT','','','','상담 후 안내','폐기형 환경 추가 인증 검증')$q$,a,s,v+1),'STEP_UP_REQUIRED');
 perform pg_temp.bank_must_fail(format($q$select public.set_krw_deposit_settings(%L,%L,'bank-auth-native','aal1','11660000-0000-4000-8000-000000000011',%s,'CONTACT','','','','상담 후 안내','폐기형 환경 인증수준 검증')$q$,a,s,v+1),'MFA_REQUIRED');
 perform pg_temp.bank_must_fail(format($q$select public.set_krw_deposit_settings(%L,%L,'bank-auth-native','aal2','11660000-0000-4000-8000-000000000010',%s,'CONTACT','','','','상담 후 안내','폐기형 환경 재사용 요청 검증')$q$,a,s,v+1),'REQUEST_ALREADY_USED');
 perform public.set_krw_deposit_settings(a,s,'bank-auth-native','aal2','11660000-0000-4000-8000-000000000012',v+1,'CONTACT','','','','1:1 상담 후 계좌 발급','폐기형 환경 상담 전환 검증');
 if not exists(select 1 from public.krw_deposit_settings where mode='CONTACT' and bank_name='' and account_number='' and account_holder='' and version=v+2) then raise exception 'Hidden account remains';end if;
 insert into public.member_registration_context(user_id,signup_ip,ip_source,referral_code,workroom_acknowledged) values(a,'192.0.2.1','CLOUDFLARE_VERIFIED','WR-TESTSIGNUP123456',true);
 perform pg_temp.bank_must_fail(format('update public.member_registration_context set signup_ip=%L where user_id=%L','192.0.2.2',a),'permission denied');
end$$;
reset role;
select extensions.ok(true,'bank publication, stale-write/replay/MFA/step-up denial, contact clearing and private signup context verified');
select * from extensions.finish();
rollback;
