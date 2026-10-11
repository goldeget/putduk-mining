-- Canonical actual-service command proposal tests, rollback-only synthetic content.
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

create temporary table recovery_cms_ctx(payload jsonb,draft jsonb,preview jsonb,approval jsonb,publication jsonb);
insert into recovery_cms_ctx(payload)values(jsonb_build_object('slug','rollback-policy-notice','title','검토용 공지','summary','로컬 검증용 안내입니다.',
 'body','이 안내는 로컬 테스트에서만 사용합니다.','ctaLabel','이용 안내 보기','ctaRoute','/about','audience','MEMBERS','segment','ALL_MEMBERS',
 'publishedAt',to_char((clock_timestamp()+interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expiresAt',null,'isPinned',false));
grant select,update on recovery_cms_ctx to service_role;
create function pg_temp.recovery_cms_command(p_operation text,p_key uuid,p_revision uuid default null,p_digest text default null,p_reason text default '검토한 안내 원고를 로컬에서 처리합니다.',p_proof text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare x record;c record;proof text;previous jsonb;
begin
 select * into x from pg_temp.recovery_admin_ctx;select * into c from pg_temp.recovery_cms_ctx;
 proof:=coalesce(p_proof,'cms-proof:'||p_key::text);
 if p_proof is null and not exists(select 1 from public.admin_step_up_grants where token_hash=encode(extensions.digest(proof,'sha256'),'hex')) then
  perform public.issue_admin_step_up(x.admin_session,x.actor,'LIVEOPS_CONTENT',proof,600);end if;
 previous:=case p_operation when 'PREVIEW' then c.draft when 'APPROVE' then c.preview when 'PUBLISH' then c.approval when 'ARCHIVE' then c.publication else null end;
 return public.manage_liveops_content(p_operation,'NOTICE',(previous->>'contentId')::uuid,coalesce(p_revision,(previous->>'revisionId')::uuid),
 coalesce(p_digest,previous->>'digest'),case p_operation when 'CREATE_DRAFT' then c.payload else null end,
 x.actor,x.admin_session,x.auth_session::text,'aal2',proof,p_reason,p_key::text);
end;
$$;
grant execute on function pg_temp.recovery_cms_command(text,uuid,uuid,text,text,text) to service_role;
select ok(not has_function_privilege('authenticated','public.manage_liveops_content(text,text,uuid,uuid,text,jsonb,uuid,uuid,text,text,text,text,text)','EXECUTE'),'members cannot publish operator content');
set local role service_role;
select throws_ok($$select pg_temp.recovery_cms_command('CREATE_DRAFT','38600000-0000-4000-8000-000000000001',p_proof=>'not-a-valid-step-up-proof')$$,'42501',null,'write requires a fresh bound proof');
update recovery_cms_ctx set draft=pg_temp.recovery_cms_command('CREATE_DRAFT','38600000-0000-4000-8000-000000000002');
select is((select draft->>'state' from recovery_cms_ctx),'DRAFT','create records a real canonical draft receipt');
select is(pg_temp.recovery_cms_command('CREATE_DRAFT','38600000-0000-4000-8000-000000000002'),(select draft from recovery_cms_ctx),'same key returns the same actual draft after single-use proof consumption');
select throws_ok($$select pg_temp.recovery_cms_command('CREATE_DRAFT','38600000-0000-4000-8000-000000000002',p_reason=>'이전과 다른 작업 사유로 변경합니다.')$$,'22023','IDEMPOTENCY_PAYLOAD_MISMATCH','same key cannot change intent/reason');
select throws_ok($$select pg_temp.recovery_cms_command('PREVIEW','38600000-0000-4000-8000-000000000003',p_revision=>'38600000-0000-4000-8000-000000000099')$$,'40001',null,'stale revision rejects review');
update recovery_cms_ctx set preview=pg_temp.recovery_cms_command('PREVIEW','38600000-0000-4000-8000-000000000004');
update recovery_cms_ctx set approval=pg_temp.recovery_cms_command('APPROVE','38600000-0000-4000-8000-000000000005');
update recovery_cms_ctx set publication=pg_temp.recovery_cms_command('PUBLISH','38600000-0000-4000-8000-000000000006');
select lives_ok('set constraints all immediate','publication seal reaches native SQL commit validation');set constraints all deferred;
select is((select publication->>'state' from recovery_cms_ctx),'PUBLISHED','reviewed approval publishes through canonical command');
select is(pg_temp.recovery_cms_command('PUBLISH','38600000-0000-4000-8000-000000000006'),(select publication from recovery_cms_ctx),'publish replay returns one original receipt');
select lives_ok($$select public.read_liveops_content_review('NOTICE',(c.publication->>'contentId')::uuid,x.actor,x.admin_session,x.auth_session::text,'aal2') from recovery_cms_ctx c cross join recovery_admin_ctx x$$,'operator read uses current bound proof and actual stored snapshot');
reset role;
select is((select count(*)::integer from public.notices where id=(select (publication->>'contentId')::uuid from recovery_cms_ctx)),1,'all replays leave one native published notice projection');
select is((select count(*)::integer from public.audit_logs where action='LIVEOPS_CONTENT_PUBLISH' and target_id=(select publication->>'contentId' from recovery_cms_ctx)),1,'publication has one original audit receipt');
select is((select count(*)::integer from public.outbox_events where event_type='LIVEOPS_CONTENT_CHANGED.v1' and aggregate_id=(select (publication->>'contentId')::uuid from recovery_cms_ctx) and payload->>'state'='PUBLISHED'),1,'publication creates one actual versioned outbox event');
select ok(exists(select 1 from public.admin_step_up_grants where user_id=(select actor from recovery_admin_ctx) and command_family='LIVEOPS_CONTENT' and consumed_at is not null),'actual one-shot family proof consumption was recorded');
update public.admin_sessions set revoked_at=clock_timestamp(),revoke_reason='rollback fixture revocation' where id=(select admin_session from recovery_admin_ctx);
set local role service_role;
select throws_ok($$select pg_temp.recovery_cms_command('PUBLISH','38600000-0000-4000-8000-000000000006')$$,'42501',null,'idempotent completed replay still needs current session authority');
reset role;
update public.admin_sessions set revoked_at=null where id=(select admin_session from recovery_admin_ctx);
update auth.sessions set factor_id=null where id=(select auth_session from recovery_admin_ctx);
set local role service_role;
select throws_ok($$select public.read_liveops_content_review('NOTICE',null,actor,admin_session,auth_session::text,'aal2') from recovery_admin_ctx$$,'42501',null,'CMS read rejects AAL2 without the exact bound verified TOTP factor');
reset role;
update auth.sessions set factor_id=(select factor from recovery_admin_ctx) where id=(select auth_session from recovery_admin_ctx);
create function pg_temp.reject_content_write_audit()returns trigger language plpgsql as $$begin
 if new.action='LIVEOPS_CONTENT_CREATE_DRAFT' then raise exception 'FIXTURE_AUDIT_REJECTED';end if;return new;end;$$;
create trigger recovery_test_cms_audit_failure before insert on public.audit_logs for each row execute function pg_temp.reject_content_write_audit();
set local role service_role;
select throws_ok($$select pg_temp.recovery_cms_command('CREATE_DRAFT','38600000-0000-4000-8000-000000000077')$$,'P0001','FIXTURE_AUDIT_REJECTED','audit insertion failure rolls back canonical write and proof consumption');
reset role;drop trigger recovery_test_cms_audit_failure on public.audit_logs;
select ok(not exists(select 1 from app_private.idempotency_keys where scope='liveops.content' and idempotency_key='38600000-0000-4000-8000-000000000077'),'failed audit does not leave a false completed command receipt');
select ok(not exists(select 1 from public.outbox_events where idempotency_key like '%38600000-0000-4000-8000-000000000077%'),'failed audit does not leak a producer outbox event');
-- Finance owner adds malformed-copy/window/edited-reset/seal-tamper rollback probes
-- and outbox producer fanout tests after registering their native trigger guards.
select * from finish();rollback;
