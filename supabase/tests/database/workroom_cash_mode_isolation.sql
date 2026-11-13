begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);
-- This generic fixture also runs in a fresh206 reset without migration-adoption seed.
create function pg_temp.cash_mode_expect_guard(statement text)returns void language plpgsql as $$begin
 begin execute statement;exception when sqlstate '55000'then
  if sqlerrm='WORKROOM_DIRECT_CASH_ENGINE_DISABLED'then return;end if;raise;end;
 raise exception 'DIRECT_CASH_ENGINE_INSERT_WAS_NOT_REJECTED';
end$$;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@cash-mode-fresh.putduk.test','',clock_timestamp(),'{}',
 app_private.workroom_native_signup_metadata('{}'),clock_timestamp(),clock_timestamp(),'','','',''
from unnest(array['11651301-0000-4000-8000-000000000001'::uuid,'11651301-0000-4000-8000-000000000002'::uuid])person;
insert into public.user_roles(user_id,role,granted_by)values
 ('11651301-0000-4000-8000-000000000002','ADMIN','11651301-0000-4000-8000-000000000002');
select public.bootstrap_user('11651301-0000-4000-8000-000000000001');
create temporary table cash_isolation_ctx(admin_id uuid,session_id uuid);
insert into cash_isolation_ctx values('11651301-0000-4000-8000-000000000002','11651301-0000-4000-8000-000000000003');
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
select session_id,admin_id,'cash-isolation-policy-session','cash-isolation-policy-fingerprint',clock_timestamp()+interval '30 minutes',
 clock_timestamp()+interval '2 hours' from cash_isolation_ctx;
-- Use the real session-bound policy lifecycle; no direct policy UPDATE or clock backdating.
do $$declare c record;manifest text;v jsonb;draft jsonb;token text;op text;at_time timestamptz;begin
 select * into strict c from pg_temp.cash_isolation_ctx;
 select jsonb_set(config,'{policyVersion}','"WORKROOM-CASH-ISOLATION-NATIVE"'::jsonb)::text into strict manifest
 from app_private.economy_policy_versions where is_reference;
 at_time:=clock_timestamp()+interval '2 seconds';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 foreach op in array array['CREATE','PREVIEW','APPROVE','PUBLISH']loop
  token:='cash-isolation-policy-'||op;
  perform public.issue_admin_step_up(c.session_id,c.admin_id,'ECONOMY_POLICY',token,600);
  v:=public.manage_economy_policy_version(op,'WORKROOM-CASH-ISOLATION-NATIVE',case when op='CREATE'then manifest end,
   case when op='CREATE'then null else(v->>'revisionId')::uuid end,
   case when op='CREATE'then null else draft->>'configDigest' end,
   case when op='CREATE'then null else at_time end,c.admin_id,c.session_id,'cash-isolation-policy-session','aal2',token,
   'Disposable native policy publication at approved100000 threshold','cash-isolation-policy-command-'||op);
  if op='CREATE'then draft:=v;end if;
 end loop;
 perform set_config('role','postgres',true);
 perform pg_sleep(greatest(0,extract(epoch from(at_time-clock_timestamp())))+0.01);
 if not exists(select 1 from app_private.economy_policy_published p where p.effective_from<=clock_timestamp()
   and p.effective_until is null and p.config->>'minimumPrincipalKrw'='100000')then raise exception 'ENABLED100000_POLICY_REQUIRED';end if;
end$$;
do $$declare u uuid:='11651301-0000-4000-8000-000000000001';a uuid:='11651301-0000-4000-8000-000000000002';r uuid;t uuid;s jsonb;n text;begin
 if not exists(select 1 from app_private.workroom_cash_enrollments where user_id=u and preserved_activation_id is null and reason='DIRECT_CASH')then
  raise exception 'FRESH_SIGNUP_NOT_ENROLLED';end if;
 if has_table_privilege('anon','app_private.workroom_cash_enrollments','SELECT')
  or has_table_privilege('authenticated','app_private.workroom_cash_enrollments','SELECT')
  or has_table_privilege('service_role','app_private.workroom_cash_enrollments','INSERT')then raise exception 'MODE_ACL_EXPOSED';end if;
 if has_function_privilege('anon','public.read_workroom_cash(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.read_workroom_cash(uuid)','EXECUTE')then raise exception 'CASH_READER_EXPOSED';end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 r:=public.create_deposit_request(u,'KRW',100000,'cash-mode-fresh-request');
 t:=public.approve_deposit_request(r,a,100000,'cash-mode-fresh-approve','Disposable fresh approved100000',gen_random_uuid());
 if public.approve_deposit_request(r,a,100000,'cash-mode-fresh-approve','Disposable fresh approved100000',gen_random_uuid())<>t then
  raise exception 'FRESH_APPROVAL_REPLAY_CHANGED_TRANSACTION';end if;
 s:=public.read_workroom_cash(u);
 if s->>'ready' is distinct from 'true'or s->>'depositedKrw' is distinct from '100000'or s->>'availableKrw' is distinct from '100000'then
  raise exception 'FRESH_APPROVED100000_NOT_VISIBLE %',s;end if;
 perform public.approve_deposit_request(public.create_deposit_request(u,'KRW',10000,'cash-mode-fresh-next-request'),
  a,10000,'cash-mode-fresh-next-approve','Disposable next approvedcash',gen_random_uuid());
 s:=public.read_workroom_cash(u);
 if s->>'availableKrw' is distinct from '110000'or s->>'depositedKrw' is distinct from '110000'then raise exception 'NEXT_CREDIT_NOT_VISIBLE %',s;end if;
 perform set_config('role','postgres',true);
 if exists(select 1 from app_private.funding_engine_activations where user_id=u)
  or exists(select 1 from app_private.funding_earned_receipts where user_id=u)
  or exists(select 1 from app_private.funding_engine_jobs where user_id=u)
  or exists(select 1 from app_private.funding_engine_state_receipts where user_id=u)
  or exists(select 1 from app_private.funding_condition_originals where user_id=u)
  or(select count(*)from public.money_source_movements where user_id=u and movement_kind='CREDIT')<>2 then
  raise exception 'FRESH_CREDIT_CREATED_ENGINE_OR_DUPLICATE';end if;
 if(select count(*)from app_private.funding_credit_boundary_completions where user_id=u
   and runtime_outcome='UNRESOLVED'and reason_code='WORKROOM_DIRECT_CASH_MODE')<>2 then raise exception 'FRESH_MODE_RECEIPTS_MISSING';end if;
 -- BEFORE guards must reject even an owner insert before other original/seal constraints.
 foreach n in array array['funding_engine_activations','funding_earned_receipts','funding_engine_jobs','funding_engine_state_receipts','funding_condition_originals','funding_allocation_originals']loop
  perform pg_temp.cash_mode_expect_guard(format('insert into app_private.%I(user_id)values(%L)',n,u));
 end loop;
 perform pg_temp.cash_mode_expect_guard(format('insert into public.funding_principal_recovery_allocations(user_id)values(%L)',u));
 if(select balance from app_private.workroom_accounts where user_id=u)<>100000 then raise exception 'CASH_CHANGED_PRACTICE_POINTS';end if;
end$$;
set constraints all immediate;
select extensions.pass('fresh direct cash100000 and repeated credits remain visible, replay-safe and isolated from legacy engine');
select * from extensions.finish();
rollback;
