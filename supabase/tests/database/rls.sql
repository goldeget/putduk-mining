begin;

-- Private bounded-history helper permission and forged-proof rejection gate.
do $bounded_privileges$
declare f record; rejected boolean; call text;
begin
 if(select count(*) from pg_proc q join pg_namespace n on n.oid=q.pronamespace
    where n.nspname='app_private' and q.proname=any(array[
    'assert_principal_history_transition_bounded','assert_input3_history_transition_bounded',
    'verify_principal_history_portion_fact_bounded','verify_input3_history_portion_fact_bounded',
    'assert_principal_history_clock_original_bounded','assert_input3_history_clock_original_bounded']))<>6 then
  raise exception 'BOUND_HELPER_EXACT_SIX_REQUIRED';end if;
 for f in select q.*,pg_get_userbyid(q.proowner) as owner_name
  from pg_proc q join pg_namespace n on n.oid=q.pronamespace
  where n.nspname='app_private' and q.proname=any(array[
    'assert_principal_history_transition_bounded','assert_input3_history_transition_bounded',
    'verify_principal_history_portion_fact_bounded','verify_input3_history_portion_fact_bounded',
    'assert_principal_history_clock_original_bounded','assert_input3_history_clock_original_bounded']) loop
  if f.owner_name<>'postgres' or f.prosecdef or f.proconfig is distinct from array['search_path=pg_catalog']::text[]
   or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
   raise exception 'BOUND_HELPER_OWNER_ONLY_PERMISSION_REQUIRED';end if;
  call:=format('select app_private.%I(null::%s,null::uuid,null::bigint)',f.proname,
   case when f.proname like '%clock_original%' then 'uuid' else 'app_private.funding_portion_transitions' end);
  rejected:=false;
  begin execute call;exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'BOUND_HELPER_NULL_PROOF_MUST_REJECT';end if;
  call:=replace(call,'null::bigint','1::bigint');
  execute 'set local role service_role';
  rejected:=false;
  begin execute call;exception when insufficient_privilege then rejected:=true;end;
  execute 'reset role';
  if not rejected then raise exception 'BOUND_HELPER_SERVICE_FORGED_PROOF_MUST_REJECT';end if;
 end loop;
end;
$bounded_privileges$;


create extension if not exists pgtap with schema extensions;

select plan(65);

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
  'every public table has RLS enabled'
);

select ok(
  (
    select bool_and(c.relforcerowsecurity)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
  'every public table forces RLS for defense in depth'
);

select ok(
  not has_table_privilege('anon', 'public.wallet_ledger', 'SELECT'),
  'anonymous clients cannot read the wallet ledger'
);

select ok(
  has_table_privilege('authenticated', 'public.wallet_ledger', 'SELECT'),
  'authenticated clients may read rows filtered by wallet RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'INSERT'),
  'authenticated clients cannot insert wallet ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'UPDATE'),
  'authenticated clients cannot update wallet ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.wallet_ledger', 'DELETE'),
  'authenticated clients cannot delete wallet ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.trial_ledger', 'INSERT'),
  'authenticated clients cannot insert trial ledger rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.mining_settlements', 'INSERT'),
  'authenticated clients cannot create mining settlements'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'user_profiles_update_own'
      and qual is not null
      and with_check is not null
  ),
  'profile update policy constrains old and new rows'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'user_settings_update_own'
      and qual is not null
      and with_check is not null
  ),
  'settings update policy constrains old and new rows'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'wallet_ledger',
        'trial_ledger',
        'mining_settlements',
        'mining_settlement_segments'
      )
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'asset ledgers and settlements have no client mutation policies'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prosecdef
      and procedure.oid not in (
        'public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb)'::regprocedure,
        'public.admit_openrouter_free_request(uuid,uuid,integer,integer)'::regprocedure,
        'app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
        'app_private.assert_event_join(uuid)'::regprocedure,
        'app_private.assert_nonmoney_notification(uuid)'::regprocedure,
        'app_private.begin_funding_credit_boundary(uuid,text)'::regprocedure,
        'app_private.capture_funding_global_control_original()'::regprocedure,
        'app_private.capture_funding_withdrawal_clock_admission(uuid,text,uuid)'::regprocedure,
        'app_private.capture_public_signup_identity()'::regprocedure,
        'app_private.carry_forward_funding_capacity(uuid,uuid,uuid)'::regprocedure,
        'app_private.claim_notification_push_deliveries(text,integer,integer)'::regprocedure,
        'app_private.consume_event_join(uuid,text)'::regprocedure,
        'app_private.consume_nonmoney_source(uuid,text)'::regprocedure,
        'app_private.consume_member_profile_audit(uuid,text)'::regprocedure,
        'app_private.consume_liveops_publication(uuid,text)'::regprocedure,
        'app_private.process_liveops_fanout_job(uuid,text)'::regprocedure,
        'app_private.verify_liveops_publication_notification()'::regprocedure,
        'app_private.guard_liveops_notification_projection()'::regprocedure,
        'app_private.emit_funded_mining_missions(uuid)'::regprocedure,
        'app_private.execute_liveops_content(text,text,uuid,uuid,text,jsonb,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
        'app_private.execute_product_catalog_command(text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text,text,text,text)'::regprocedure,
        'app_private.execute_product_catalog_review_read(uuid,uuid,uuid,text,text)'::regprocedure,
        'app_private.execute_trial_settlement(uuid,text)'::regprocedure,
        'app_private.finish_funding_credit_boundary(uuid)'::regprocedure,
        'app_private.finish_principal_runtime_boundary(uuid)'::regprocedure,
        'app_private.guard_event_join_delivery()'::regprocedure,
        'app_private.guard_event_join_envelope()'::regprocedure,
        'app_private.guard_funded_mining_mission_outbox()'::regprocedure,
        'app_private.guard_liveops_sealed_links()'::regprocedure,
        'app_private.guard_nonmoney_envelope()'::regprocedure,
        'app_private.guard_nonmoney_notification_projection()'::regprocedure,
        'app_private.guard_push_delivery_original()'::regprocedure,
        'app_private.guard_trial_completion_source()'::regprocedure,
        'app_private.participate_published_event(uuid,uuid,uuid,uuid)'::regprocedure,
        'app_private.prepare_principal_recovery_intent(uuid,uuid)'::regprocedure,
        'app_private.read_funding_runtime_server_display(uuid)'::regprocedure,
        'app_private.read_liveops_content(text,uuid,uuid,uuid,text,text)'::regprocedure,
        'app_private.read_neutral_funding_job_inputs(uuid,uuid,timestamp with time zone)'::regprocedure,
        'app_private.read_verified_credit_funding_inputs(uuid,uuid,timestamp with time zone)'::regprocedure,
        'app_private.settle_notification_push_delivery(uuid,text,uuid,integer,text,integer,text)'::regprocedure,
        'app_private.validate_event_member_projection()'::regprocedure,
        'app_private.validate_product_catalog_publication_trigger()'::regprocedure,
        'app_private.verify_balanced_ledger_at_commit()'::regprocedure,
        'app_private.verify_credit_boundary_commit()'::regprocedure,
        'app_private.verify_event_join()'::regprocedure,
        'app_private.verify_event_participant_join()'::regprocedure,
        'app_private.verify_funded_mining_mission_commit()'::regprocedure,
        'app_private.verify_funding_global_control_commit()'::regprocedure,
        'app_private.verify_funding_integrity_at_commit()'::regprocedure,
        'app_private.verify_funding_portion_transition()'::regprocedure,
        'app_private.verify_funding_withdrawal_clock_commit()'::regprocedure,
        'app_private.verify_liveops_receipt_commit()'::regprocedure,
        'app_private.verify_member_principal_confirmation_commit()'::regprocedure,
        'app_private.verify_nonmoney_award_commit()'::regprocedure,
        'app_private.verify_nonmoney_notification()'::regprocedure,
        'app_private.verify_nonmoney_policy_commit()'::regprocedure,
        'app_private.verify_principal_boundary_commit()'::regprocedure,
        'app_private.verify_principal_recovery_intent_commit()'::regprocedure,
        'app_private.verify_trial_completion_original_commit()'::regprocedure,
        'app_private.seal_worker_pause_attempt()'::regprocedure,
        'app_private.consume_local_cash_source(uuid,text)'::regprocedure,
        'app_private.read_member_cash_event_terms()'::regprocedure,
        'app_private.assert_local_cash_credit(public.money_source_movements)'::regprocedure,
        'app_private.verify_local_cash_commit()'::regprocedure,
        'app_private.participate_published_event(uuid,uuid,uuid,uuid,text)'::regprocedure,
        'public.bootstrap_user(uuid)'::regprocedure,
        'public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)'::regprocedure,
        'public.is_login_id_available(text)'::regprocedure,
        'public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)'::regprocedure,
        'public.read_ai_provider_usage(uuid)'::regprocedure,
        'public.reserve_ai_provider_attempt(uuid,uuid,text,text,text,bigint,boolean)'::regprocedure,
        'public.resolve_login_email(text)'::regprocedure,
        'public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint,bigint,text)'::regprocedure,
        'public.signup_phone_availability(text)'::regprocedure
      )
  )
    and (
      select count(*) = 74
        and coalesce(
          bool_and(
            procedure.proconfig @> array['search_path=pg_catalog']::text[]
          ),
          false
        )
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('public', 'app_private')
        and procedure.prosecdef
    ),
  'application schemas contain only the seventy-four reviewed fixed-search-path SECURITY DEFINER functions'
);

select ok(
  (
    select count(*) = 4
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'world_rule_versions_prevent_update_delete',
        'trial_reward_curves_prevent_update_delete',
        'trial_reward_curve_points_prevent_update_delete',
        'mining_equipment_history_prevent_delete'
      )
  ),
  'versioned economy inputs and equipment history are mutation protected'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgname = 'trial_programs_validate_before_enable'
  ),
  'trial programs must pass curve validation before enablement'
);

select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT'),
  'authenticated clients cannot read Web Push credentials'
);

select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT'),
  'authenticated clients cannot write Web Push credentials directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.upsert_push_subscription(uuid,text,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'service role can register a push subscription atomically'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_push_subscription(uuid,text,text,text,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the push registration command directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.revoke_push_subscription(uuid,text)',
    'EXECUTE'
  ),
  'service role can revoke a push subscription atomically'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.revoke_push_subscription(uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the push revocation command directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.analytics_events', 'INSERT'),
  'analytics events are ingested by the server only'
);

select ok(
  has_table_privilege('service_role', 'public.analytics_events', 'INSERT'),
  'service role can insert server-ingested analytics events'
);

select ok(
  has_table_privilege('service_role', 'public.analytics_events', 'SELECT'),
  'service role can return inserted analytics events'
);

select ok(
  to_regclass('public.analytics_events_request_id_unique') is not null,
  'analytics request ids have a database deduplication boundary'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_requests', 'INSERT'),
  'AI requests are orchestrated by the server only'
);

select ok(
  not has_table_privilege('anon', 'public.event_rules', 'SELECT'),
  'internal event rule payloads are not exposed publicly'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_cache', 'SELECT'),
  'AI cache rows are server-only'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'notifications_mark_own_read'
      and qual is not null
      and with_check is not null
  ),
  'notification read updates constrain old and new rows'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_preferences'
      and policyname = 'notification_preferences_update_own'
      and qual is not null
      and with_check is not null
  ),
  'notification preference updates constrain old and new rows'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'trust_versions'
      and policyname = 'trust_versions_read_public'
      and cmd = 'SELECT'
  ),
  'published trust versions have an explicit public read policy'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type = 'DELETE'
  ),
  'client roles have no direct DELETE grants on public tables'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type = 'INSERT'
  ),
  'client roles have no direct INSERT grants on public tables'
);

select ok(
  has_function_privilege('service_role', 'public.bootstrap_user(uuid)', 'EXECUTE'),
  'service role can execute bootstrap_user'
);
select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_user(uuid)', 'EXECUTE'),
  'authenticated clients cannot execute bootstrap_user'
);

select ok(
  has_function_privilege('service_role', 'public.start_trial(uuid,text)', 'EXECUTE'),
  'service role can execute start_trial'
);
select ok(
  not has_function_privilege('authenticated', 'public.start_trial(uuid,text)', 'EXECUTE'),
  'authenticated clients cannot execute start_trial'
);

select ok(
  has_function_privilege('service_role', 'public.settle_trial(uuid,text)', 'EXECUTE'),
  'service role can execute settle_trial'
);
select ok(
  not has_function_privilege('authenticated', 'public.settle_trial(uuid,text)', 'EXECUTE'),
  'authenticated clients cannot execute settle_trial'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_deposit_request(uuid,public.currency_code,bigint,text)',
    'EXECUTE'
  ),
  'service role can execute create_deposit_request'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_deposit_request(uuid,public.currency_code,bigint,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute create_deposit_request'
);
select ok(
  has_table_privilege('service_role', 'public.deposit_requests', 'INSERT'),
  'service role can insert deposit requests for the invoker command'
);
select ok(
  not has_table_privilege('authenticated', 'public.deposit_requests', 'INSERT'),
  'authenticated clients cannot insert deposit requests'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)',
    'EXECUTE'
  ),
  'service role cannot execute the retired seven-argument withdrawal writer'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute create_withdrawal_request'
);

select ok(
  not has_table_privilege('authenticated', 'public.withdrawal_policies', 'SELECT'),
  'withdrawal policies are exposed through bounded server views only'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgname = 'withdrawal_policies_prevent_update_delete'
  ),
  'withdrawal policy versions are append-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute approve_deposit_request'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.approve_deposit_request(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute approve_deposit_request'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.record_mining_settlement(uuid,uuid,timestamp with time zone,timestamp with time zone,bigint,public.currency_code,jsonb,text)',
    'EXECUTE'
  ),
  'service role cannot execute caller-amount legacy record_mining_settlement'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_mining_settlement(uuid,uuid,timestamp with time zone,timestamp with time zone,bigint,public.currency_code,jsonb,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute record_mining_settlement'
);

select ok(
  (
    select count(*) = 3
      and bool_and('security_invoker=true' = any (coalesce(view.reloptions, '{}'::text[])))
    from pg_class as view
    join pg_namespace as namespace on namespace.oid = view.relnamespace
    where namespace.nspname = 'public'
      and view.relname in (
        'wallet_balance_snapshots',
        'trial_account_snapshots',
        'mining_active_session_snapshots'
      )
  ),
  'all user read models are security-invoker views'
);

select ok(
  not has_table_privilege('anon', 'public.wallet_balance_snapshots', 'SELECT'),
  'anonymous clients cannot read wallet balance snapshots'
);

select ok(
  has_table_privilege('authenticated', 'public.wallet_balance_snapshots', 'SELECT'),
  'authenticated clients can read their RLS-filtered wallet snapshots'
);

select ok(
  not has_table_privilege('anon', 'public.trial_account_snapshots', 'SELECT'),
  'anonymous clients cannot read trial account snapshots'
);

select ok(
  has_table_privilege(
    'authenticated',
    'public.mining_active_session_snapshots',
    'SELECT'
  ),
  'authenticated clients can read their RLS-filtered active mining snapshot'
);

select ok(
  to_regclass('public.ai_requests_user_client_message_unique') is not null,
  'AI client message ids have a per-user database deduplication boundary'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)',
    'EXECUTE'
  ),
  'service role can admit AI requests'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_ai_request(uuid,uuid,text,jsonb,text,text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot admit AI requests directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_ai_request(uuid,uuid,text,text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'service role can complete AI requests with usage'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_ai_request(uuid,uuid,text,text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot complete AI requests directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.fail_ai_request(uuid,uuid,public.ai_request_status,text)',
    'EXECUTE'
  ),
  'service role can record AI failures and cancellations'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.fail_ai_request(uuid,uuid,public.ai_request_status,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot record AI terminal states directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.bootstrap_first_super_admin(uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute the one-time first admin bootstrap'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.bootstrap_first_super_admin(uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bootstrap the first admin'
);

select * from finish();

rollback;
