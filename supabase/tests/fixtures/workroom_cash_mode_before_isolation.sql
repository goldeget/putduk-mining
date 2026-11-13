-- Disposable native fixture only: install after205 and before206, then commit.
begin;
create table workroom_native_evidence.cash_mode_context(
 user_id uuid primary key,admin_id uuid not null,session_id uuid not null,
 request_id uuid,transaction_id uuid,activation_id uuid,originals jsonb
);
revoke all on workroom_native_evidence.cash_mode_context from public,anon,authenticated,service_role;
insert into workroom_native_evidence.cash_mode_context(user_id,admin_id,session_id)
values('11651300-0000-4000-8000-000000000001','11651300-0000-4000-8000-000000000002','11651300-0000-4000-8000-000000000003');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@cash-mode-native.putduk.test','',clock_timestamp(),'{}',
 app_private.workroom_native_signup_metadata('{}'),clock_timestamp(),clock_timestamp(),'','','',''
from workroom_native_evidence.cash_mode_context cross join lateral unnest(array[user_id,admin_id]) person;
insert into public.user_roles(user_id,role,granted_by)select admin_id,'ADMIN',admin_id from workroom_native_evidence.cash_mode_context;
select public.bootstrap_user(user_id)from workroom_native_evidence.cash_mode_context;
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
select session_id,admin_id,'cash-mode-policy-session','cash-mode-policy-fingerprint',clock_timestamp()+interval '30 minutes',
 clock_timestamp()+interval '2 hours' from workroom_native_evidence.cash_mode_context;
-- Use the real session-bound policy lifecycle; no direct policy UPDATE or clock backdating.
do $$declare c record;manifest text;v jsonb;draft jsonb;token text;op text;at_time timestamptz;begin
 select * into strict c from workroom_native_evidence.cash_mode_context;
 select jsonb_set(config,'{policyVersion}','"WORKROOM-CASH-MODE-NATIVE"'::jsonb)::text into strict manifest
 from app_private.economy_policy_versions where is_reference;
 at_time:=clock_timestamp()+interval '2 seconds';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 foreach op in array array['CREATE','PREVIEW','APPROVE','PUBLISH']loop
  token:='cash-mode-policy-'||op;
  perform public.issue_admin_step_up(c.session_id,c.admin_id,'ECONOMY_POLICY',token,600);
  v:=public.manage_economy_policy_version(op,'WORKROOM-CASH-MODE-NATIVE',case when op='CREATE'then manifest end,
   case when op='CREATE'then null else(v->>'revisionId')::uuid end,
   case when op='CREATE'then null else draft->>'configDigest' end,
   case when op='CREATE'then null else at_time end,c.admin_id,c.session_id,'cash-mode-policy-session','aal2',token,
   'Disposable native policy publication at approved100000 threshold','cash-mode-policy-command-'||op);
  if op='CREATE'then draft:=v;end if;
 end loop;
 perform set_config('role','postgres',true);
 perform pg_sleep(greatest(0,extract(epoch from(at_time-clock_timestamp())))+0.01);
 if not exists(select 1 from app_private.economy_policy_published p where p.effective_from<=clock_timestamp()
   and p.effective_until is null and p.config->>'minimumPrincipalKrw'='100000')then raise exception 'ENABLED100000_POLICY_REQUIRED';end if;
end$$;
-- Actual canonical approval with service role and engine claims: this reproduces
-- the production threshold bug rather than the SQL-only unresolved fallback.
do $$declare c record;r uuid;t uuid;s jsonb;begin
 select * into strict c from workroom_native_evidence.cash_mode_context;
 perform set_config('role','service_role',true);
 r:=public.create_deposit_request(c.user_id,'KRW',100000,'cash-mode-before-request');
 t:=public.approve_deposit_request(r,c.admin_id,100000,'cash-mode-before-approve','Disposable native actual approved100000',gen_random_uuid());
 s:=public.read_workroom_cash(c.user_id);
 if s->>'ready' is distinct from 'false'then raise exception 'BEFORE206_BUG_NOT_REPRODUCED %',s;end if;
 perform set_config('role','postgres',true);
 update workroom_native_evidence.cash_mode_context set request_id=r,transaction_id=t;
end$$;
set constraints all immediate;
do $$declare c record;a app_private.funding_engine_activations%rowtype;j jsonb;begin
 select * into strict c from workroom_native_evidence.cash_mode_context;
 select * into strict a from app_private.funding_engine_activations where user_id=c.user_id;
 if a.runtime_version<>2 or exists(select 1 from app_private.funding_earned_receipts where user_id=c.user_id)
  or exists(select 1 from app_private.funding_engine_jobs where user_id=c.user_id)
  or(select count(*)from app_private.funding_engine_state_receipts where user_id=c.user_id)<>1 then
  raise exception 'BEFORE206_INERT_RUNTIME2_REQUIRED';end if;
 j:=jsonb_build_object('activation',to_jsonb(a),
 'states',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_engine_state_receipts x where user_id=c.user_id),
 'conditions',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_condition_originals x where user_id=c.user_id),
 'cycles',(select jsonb_agg(to_jsonb(x)order by id)from app_private.funding_cycle_windows x where user_id=c.user_id));
 update workroom_native_evidence.cash_mode_context set activation_id=a.id,originals=j;
end$$;
-- The next canonical approval writes its original before the audit seal.
set constraints all deferred;
-- A genuine WORKROOM signup that already acquired earned/state history must
-- remain outside adoption, even though its deposit path otherwise looks similar.
create table workroom_native_evidence.cash_mode_legacy_control(user_id uuid primary key,states bigint,earned bigint);
revoke all on workroom_native_evidence.cash_mode_legacy_control from public,anon,authenticated,service_role;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
values('11651300-0000-4000-8000-000000000004','authenticated','authenticated','cash-mode-established@putduk.test','',
 clock_timestamp(),'{}',app_private.workroom_native_signup_metadata('{}'),clock_timestamp(),clock_timestamp(),'','','','');
select public.bootstrap_user('11651300-0000-4000-8000-000000000004');
do $$declare u uuid:='11651300-0000-4000-8000-000000000004';a uuid;begin
 select admin_id into strict a from workroom_native_evidence.cash_mode_context;
 perform set_config('role','service_role',true);
 perform public.approve_deposit_request(public.create_deposit_request(u,'KRW',100000,'cash-mode-established-request1'),a,
  100000,'cash-mode-established-approve1','Disposable established legacy first credit',gen_random_uuid());
 perform public.approve_deposit_request(public.create_deposit_request(u,'KRW',1000,'cash-mode-established-request2'),a,
  1000,'cash-mode-established-approve2','Disposable established legacy next credit',gen_random_uuid());
 perform set_config('role','postgres',true);
 insert into workroom_native_evidence.cash_mode_legacy_control select u,
  (select count(*)from app_private.funding_engine_state_receipts where user_id=u),
  (select count(*)from app_private.funding_earned_receipts where user_id=u);
 if not exists(select 1 from workroom_native_evidence.cash_mode_legacy_control where states>=2 and earned>=1)then
  raise exception 'ESTABLISHED_LEGACY_CONTROL_NOT_REPRODUCED';end if;
end$$;
set constraints all immediate;
commit;
