begin;

-- BEGIN TEST-ONLY HISTORICAL HOLD FIXTURE
-- Test-only original receipt fixture. Never installed by a migration.
-- pg_temp plus postgres-only execution isolates it from service/public callers.
-- Call inside the owning test transaction; rollback/session end removes it.
-- It represents a source-less historical hold, NOT VERIFIED MINING_REWARD.
create function pg_temp.seed_historical_held_withdrawal(
  p_owner uuid, p_destination uuid, p_amount bigint, p_key text
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $historical_fixture$
declare
  v_destination public.withdrawal_destinations%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_wallet uuid;
  v_request uuid;
  v_command_request uuid := gen_random_uuid();
  v_journal uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'HISTORICAL_FIXTURE_OWNER_ONLY';
  end if;
  if p_amount is null or p_amount <= 0 or char_length(p_key) not between 8 and 200 then
    raise exception 'INVALID_HISTORICAL_FIXTURE';
  end if;
  if exists (select 1 from public.withdrawal_requests
    where user_id = p_owner and idempotency_key = p_key) then
    raise exception 'HISTORICAL_FIXTURE_ALREADY_EXISTS';
  end if;
  select * into v_destination from public.withdrawal_destinations
  where id = p_destination and user_id = p_owner and verification_status = 'VERIFIED';
  select * into v_policy from public.withdrawal_policies
  where currency = 'KRW' and destination_type = v_destination.destination_type
    and is_enabled and effective_at <= statement_timestamp()
    and (expires_at is null or expires_at > statement_timestamp())
  order by version desc limit 1;
  select id into v_wallet from public.wallet_accounts
  where user_id = p_owner and currency = 'KRW' and closed_at is null;
  if v_destination.id is null or v_policy.id is null or v_wallet is null
    or app_private.available_krw_balance(v_wallet) < p_amount + v_policy.fee_atomic then
    raise exception 'HISTORICAL_FIXTURE_RECEIPT_UNAVAILABLE';
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, withdrawal_destination_id,
    user_id, currency, amount_atomic, fee_atomic, destination_type,
    destination_snapshot, status, idempotency_key
  ) values (
    v_wallet, v_policy.id, v_destination.id, p_owner, 'KRW', p_amount,
    v_policy.fee_atomic, v_destination.destination_type,
    jsonb_build_object('destination_id', v_destination.id,
      'display', v_destination.display_hint, 'verified_at', v_destination.verified_at),
    'REQUESTED', p_key
  ) returning id into v_request;
  v_journal := app_private.post_withdrawal_hold(
    p_owner, v_request, p_amount + v_policy.fee_atomic, p_key, v_command_request
  );
  update public.withdrawal_requests set status = 'HELD',
    hold_ledger_transaction_id = v_journal, hold_posted_at = statement_timestamp()
  where id = v_request;
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_REQUESTED.v1', 1, 'withdrawal_request', v_request, p_owner,
    jsonb_build_object('user_id', p_owner, 'amount_atomic', p_amount::text,
      'fee_atomic', v_policy.fee_atomic::text, 'currency', 'KRW',
      'destination_type', v_destination.destination_type,
      'hold_ledger_transaction_id', v_journal, 'welcome_reward', false),
    gen_random_uuid(), v_command_request, p_key || ':event'
  );
  insert into public.transaction_receipts (
    receipt_number, user_id, transaction_type, source_type, source_id,
    amount_atomic, currency, status, requested_at, status_timeline
  ) values (
    'PDK-WD-' || upper(replace(v_request::text, '-', '')), p_owner, 'WITHDRAWAL',
    'withdrawal_request', v_request, p_amount, 'KRW', 'HELD', statement_timestamp(),
    jsonb_build_array(
      jsonb_build_object('status', 'REQUESTED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'HELD', 'at', statement_timestamp()))
  );
  return v_request;
end;
$historical_fixture$;
revoke all on function pg_temp.seed_historical_held_withdrawal(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
-- END TEST-ONLY HISTORICAL HOLD FIXTURE


create extension if not exists pgtap with schema extensions;

select plan(43);

create temporary table ws04_ctx (
  user_a uuid not null,
  user_b uuid not null,
  operator_id uuid not null,
  wallet_a uuid,
  destination_a uuid,
  policy_krw uuid,
  withdrawal_id uuid,
  hold_tx uuid,
  release_tx uuid,
  send_id uuid,
  finalize_tx uuid,
  deposit_instruction uuid,
  deposit_id uuid,
  deposit_ledger uuid
);

insert into ws04_ctx (user_a, user_b, operator_id)
values (
  'a1111111-1111-4111-8111-111111111111',
  'b2222222-2222-4222-8222-222222222222',
  'c3333333-3333-4333-8333-333333333333'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select
  id, 'authenticated', 'authenticated', email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select user_a as id, 'ws04-a@putduk.test' as email from ws04_ctx
  union all
  select user_b, 'ws04-b@putduk.test' from ws04_ctx
  union all
  select operator_id, 'ws04-op@putduk.test' from ws04_ctx
) as users;

insert into public.user_roles (user_id, role, granted_by)
select operator_id, 'ADMIN', operator_id from ws04_ctx;

select public.bootstrap_user((select user_a from ws04_ctx));
select public.bootstrap_user((select user_b from ws04_ctx));

update ws04_ctx
set wallet_a = account.id
from public.wallet_accounts as account
where account.user_id = ws04_ctx.user_a
  and account.currency = 'KRW';

-- Phone availability shape
select ok(
  (
    select count(*) = 83
      and bool_and(procedure.proconfig @> array['search_path=pg_catalog']::text[])
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prosecdef
      and procedure.oid in (
        'app_private.bind_push_delivery_epoch()'::regprocedure,
        'app_private.apply_member_push_binding(uuid,uuid,text,text,text,text,timestamp with time zone,text)'::regprocedure,
        'app_private.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamp with time zone,text,bigint,uuid,uuid)'::regprocedure,
        'app_private.check_push_delivery_admission(uuid,text,uuid,integer)'::regprocedure,
        'app_private.bind_notice_content_projection()'::regprocedure,
        'app_private.guard_notice_content_projection()'::regprocedure,
        'public.read_member_faq()'::regprocedure,
        'app_private.seal_worker_pause_attempt()'::regprocedure,
        'app_private.consume_local_cash_source(uuid,text)'::regprocedure,
        'app_private.read_member_cash_event_terms()'::regprocedure,
        'app_private.assert_local_cash_credit(public.money_source_movements)'::regprocedure,
        'app_private.verify_local_cash_commit()'::regprocedure,
        'app_private.participate_published_event(uuid,uuid,uuid,uuid,text)'::regprocedure,
        'public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb)'::regprocedure,
        'public.admit_openrouter_free_request(uuid,uuid,integer,integer)'::regprocedure,
        'app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
        'app_private.ack_nonmoney_award_outbox(uuid,text)'::regprocedure,
        'app_private.ack_withdrawal_lifecycle_outbox(uuid,text)'::regprocedure,
        'app_private.assert_event_join(uuid)'::regprocedure,
        'app_private.assert_nonmoney_notification(uuid)'::regprocedure,
        'app_private.begin_funding_credit_boundary(uuid,text)'::regprocedure,
        'app_private.capture_funding_global_control_original()'::regprocedure,
        'app_private.capture_funding_withdrawal_clock_admission(uuid,text,uuid)'::regprocedure,
        'app_private.capture_public_signup_identity()'::regprocedure,
        'app_private.carry_forward_funding_capacity(uuid,uuid,uuid)'::regprocedure,
        'app_private.claim_notification_push_deliveries(text,integer,integer)'::regprocedure,
        'app_private.consume_event_join(uuid,text)'::regprocedure,
        'app_private.consume_member_profile_audit(uuid,text)'::regprocedure,
        'app_private.consume_nonmoney_source(uuid,text)'::regprocedure,
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
    and not exists (
      select 1
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('public', 'app_private')
        and procedure.prosecdef
        and procedure.oid not in (
          'app_private.bind_push_delivery_epoch()'::regprocedure,
          'app_private.apply_member_push_binding(uuid,uuid,text,text,text,text,timestamp with time zone,text)'::regprocedure,
          'app_private.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamp with time zone,text,bigint,uuid,uuid)'::regprocedure,
          'app_private.check_push_delivery_admission(uuid,text,uuid,integer)'::regprocedure,
          'app_private.bind_notice_content_projection()'::regprocedure,
          'app_private.guard_notice_content_projection()'::regprocedure,
          'public.read_member_faq()'::regprocedure,
          'app_private.seal_worker_pause_attempt()'::regprocedure,
          'app_private.consume_local_cash_source(uuid,text)'::regprocedure,
        'app_private.read_member_cash_event_terms()'::regprocedure,
          'app_private.assert_local_cash_credit(public.money_source_movements)'::regprocedure,
          'app_private.verify_local_cash_commit()'::regprocedure,
          'app_private.participate_published_event(uuid,uuid,uuid,uuid,text)'::regprocedure,
        'public.admin_read_ai_conversations(uuid,uuid,uuid,text,jsonb)'::regprocedure,
        'public.admit_openrouter_free_request(uuid,uuid,integer,integer)'::regprocedure,
        'app_private.approve_local_nonmoney_policy(uuid,uuid,uuid,integer,text,text,text,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
        'app_private.ack_nonmoney_award_outbox(uuid,text)'::regprocedure,
        'app_private.ack_withdrawal_lifecycle_outbox(uuid,text)'::regprocedure,
        'app_private.assert_event_join(uuid)'::regprocedure,
        'app_private.assert_nonmoney_notification(uuid)'::regprocedure,
        'app_private.begin_funding_credit_boundary(uuid,text)'::regprocedure,
        'app_private.capture_funding_global_control_original()'::regprocedure,
        'app_private.capture_funding_withdrawal_clock_admission(uuid,text,uuid)'::regprocedure,
        'app_private.capture_public_signup_identity()'::regprocedure,
        'app_private.carry_forward_funding_capacity(uuid,uuid,uuid)'::regprocedure,
        'app_private.claim_notification_push_deliveries(text,integer,integer)'::regprocedure,
        'app_private.consume_event_join(uuid,text)'::regprocedure,
        'app_private.consume_member_profile_audit(uuid,text)'::regprocedure,
        'app_private.consume_nonmoney_source(uuid,text)'::regprocedure,
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
      -- The two Notice additions are private, fixed-context trigger functions.
      -- Keep the original exact global roster check and audit each new identity.
      select count(*) = 2 and coalesce(bool_and(
        procedure.prosecdef
        and procedure.prorettype = 'pg_catalog.trigger'::regtype
        and procedure.proowner = 'postgres'::regrole
        and procedure.proconfig = array['search_path=pg_catalog']::text[]
        and encode(extensions.digest(procedure.prosrc, 'sha256'), 'hex') = expected.source_sha256
        and not exists (
          select 1 from aclexplode(coalesce(procedure.proacl,
            acldefault('f', procedure.proowner))) as privilege
          where privilege.privilege_type = 'EXECUTE'
            and privilege.grantee <> procedure.proowner
        )
        and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      ), false)
      from (values
        ('app_private.bind_notice_content_projection()'::regprocedure,
          '716796e00270b54026e50a6e6805b13793e045fbc1f9915a714223b9d3fff252'),
        ('app_private.guard_notice_content_projection()'::regprocedure,
          '8500d2dfbc5d022448d4ece02aab177e1391a8bca2d2026ac09dbd5ca07539ad')
      ) as expected(function_oid, source_sha256)
      join pg_proc as procedure on procedure.oid = expected.function_oid
    )
    and (
      -- Reject a missing, disabled, redirected, conditional, or extra binding.
      select count(*) = 2 and coalesce(bool_and(
        trigger.tgrelid = 'public.notices'::regclass
        and trigger.tgenabled = 'O'
        and not trigger.tgisinternal
        and trigger.tgconstraint = 0
        and trigger.tgnargs = 0
        and trigger.tgqual is null
        and trigger.tgattr = ''::pg_catalog.int2vector
        and ((trigger.tgfoid = 'app_private.bind_notice_content_projection()'::regprocedure
          and trigger.tgname = 'notice_content_source_bind' and trigger.tgtype::integer = 7)
          or (trigger.tgfoid = 'app_private.guard_notice_content_projection()'::regprocedure
          and trigger.tgname = 'notice_content_source_guard' and trigger.tgtype::integer = 27))
      ), false)
      from pg_trigger as trigger
      where trigger.tgfoid in (
        'app_private.bind_notice_content_projection()'::regprocedure,
        'app_private.guard_notice_content_projection()'::regprocedure
      )
    )
    and (
      -- Frozen Push adds one private trigger and three service-context transport functions.
      select count(*) = 4 and coalesce(bool_and(
        procedure.prosecdef
        and procedure.proowner = 'postgres'::regrole
        and procedure.prorettype = expected.return_type
        and procedure.proconfig = array['search_path=pg_catalog']::text[]
        -- Only line-ending CRLF pairs may normalize; every canonical body byte is pinned.
        and position(chr(13) in replace(procedure.prosrc, chr(13)||chr(10), chr(10))) = 0
        and encode(extensions.digest(replace(procedure.prosrc, chr(13)||chr(10), chr(10)), 'sha256'), 'hex') = expected.source_sha256
        and not exists (
          select 1 from aclexplode(coalesce(procedure.proacl,
            acldefault('f', procedure.proowner))) as privilege
          where privilege.privilege_type = 'EXECUTE'
            and privilege.grantee <> procedure.proowner
            and not (expected.service_transport and privilege.grantee = 'service_role'::regrole
              and privilege.is_grantable = false)
        )
        and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        and has_function_privilege('service_role', procedure.oid, 'EXECUTE') = expected.service_transport
      ), false)
      from (values
        ('app_private.bind_push_delivery_epoch()'::regprocedure, 'fde05c05151e3d065729a06ccae6e8a31230113b40c8f7459fc8f4dc0d595553', 'pg_catalog.trigger'::regtype, false),
        ('app_private.apply_member_push_binding(uuid,uuid,text,text,text,text,timestamp with time zone,text)'::regprocedure, 'fff205f83e8ae30cfdc7fdde37e7548bf5c0c5978ca1b1955a5b185d6b798e25', 'pg_catalog.jsonb'::regtype, true),
        ('app_private.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamp with time zone,text,bigint,uuid,uuid)'::regprocedure, 'b553103c7bfa2c363e49ba8169cc90e00a436654393764903a3a47fa4719cbe2', 'pg_catalog.jsonb'::regtype, true),
        ('app_private.check_push_delivery_admission(uuid,text,uuid,integer)'::regprocedure, '10379eb3851f86be2445d3b8d764bc8ac089612c3cc8ee181a4cc2873643b5dd', 'pg_catalog.jsonb'::regtype, true)
      ) as expected(function_oid, source_sha256, return_type, service_transport)
      join pg_proc as procedure on procedure.oid = expected.function_oid
    )
    and (
      -- The trigger-only entry point has exactly its reviewed unconditional ROW binding.
      select count(*) = 1 and coalesce(bool_and(
        trigger.tgrelid = 'app_private.notification_device_deliveries'::regclass
        and trigger.tgname = 'push_delivery_epoch_immutable'
        and trigger.tgenabled = 'O' and not trigger.tgisinternal
        and trigger.tgconstraint = 0 and trigger.tgnargs = 0
        and trigger.tgqual is null
        and trigger.tgattr = ''::pg_catalog.int2vector
        and trigger.tgtype::integer = 23
      ), false)
      from pg_trigger as trigger
      where trigger.tgfoid = 'app_private.bind_push_delivery_epoch()'::regprocedure
    ),
  'application schemas contain only the reviewed fixed-search-path SECURITY DEFINER functions'
);

select is(
  public.normalize_signup_phone('010-9876-5432'),
  '+821098765432',
  'normalize_signup_phone converts Korea local numbers'
);

select is(
  public.signup_phone_availability('010-1111-2222'),
  'AVAILABLE',
  'fresh phone is AVAILABLE'
);

select is(
  public.signup_phone_availability('not-a-phone'),
  'UNAVAILABLE',
  'invalid phone is UNAVAILABLE without leaking identity'
);

insert into public.signup_phone_history (phone_e164, user_id, source)
values ('+821011112222', (select user_a from ws04_ctx), 'SIGNUP');

select is(
  public.signup_phone_availability('010-1111-2222'),
  'UNAVAILABLE',
  'historical signup phone is UNAVAILABLE'
);

select is(
  public.signup_phone_availability('+821011112222'),
  'UNAVAILABLE',
  'phone availability never returns account identifiers'
);

-- Unclassified historical wallet fixture: not a qualified START or verified reward.
insert into public.wallet_ledger (
  wallet_account_id, user_id, direction, entry_type, amount_atomic,
  idempotency_key, reference_type, reference_id, reason
)
select
  wallet_a, user_a, 'CREDIT', 'DEPOSIT', 20000,
  'ws04-fund-a', 'test', user_a, 'ws04 fixture'
from ws04_ctx;

insert into public.ledger_accounts (code, currency, account_class, normal_side, owner_user_id)
select
  'USER:' || upper(user_a::text) || ':KRW:LIABILITY',
  'KRW', 'LIABILITY', 'CREDIT', user_a
from ws04_ctx
on conflict (code) do nothing;

insert into public.ledger_accounts (code, currency, account_class, normal_side, is_controlled_asset)
values
  ('PUTDUK:OPERATING_CASH:KRW', 'KRW', 'ASSET', 'DEBIT', true),
  ('PUTDUK:WITHDRAWAL_HOLD:KRW', 'KRW', 'CLEARING', 'CREDIT', false)
on conflict (code) do nothing;

insert into public.withdrawal_policies (
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select
  'KRW', 'KRW_BANK', 9101, true, 1000, 0,
  '{}'::jsonb, statement_timestamp(), operator_id, false
from ws04_ctx;

update ws04_ctx
set policy_krw = policy.id
from public.withdrawal_policies as policy
where policy.version = 9101
  and policy.destination_type = 'KRW_BANK';

update ws04_ctx
set destination_a = public.register_krw_bank_destination(
  user_a,
  decode('00112233445566778899aabbccddeeff', 'hex'),
  'fp-ws04-bank-a',
  '국민 **1234',
  'step-up-token-ws04-a',
  'd4444444-4444-4444-8444-444444444444',
  1
);

select ok(
  (
    select destination.protection_until <= statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'first KRW_BANK destination registration does not apply cooldown'
);

select throws_ok($general_source$select public.request_krw_withdrawal(
  user_a,
  destination_a,
  5000,
  'ws04-hold-once-0001') from ws04_ctx$general_source$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'fresh general request cannot consume unverified total KRW');

-- Historical receipt fixture only; never a verified mining/source producer.
update ws04_ctx
set withdrawal_id = pg_temp.seed_historical_held_withdrawal(
  user_a,
  destination_a,
  5000,
  'ws04-hold-once-0001'
);

select isnt(
  (select withdrawal_id from ws04_ctx),
  null,
  'historical original receipt fixture contains a held withdrawal'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'HELD',
  'withdrawal is HELD after ledger reservation'
);

select ok(
  (
    select hold_ledger_transaction_id is not null
      and currency = 'KRW'
      and destination_type = 'KRW_BANK'
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'normal KRW withdrawal uses held KRW'
);

select is(
  public.request_krw_withdrawal(
    (select user_a from ws04_ctx),
    (select destination_a from ws04_ctx),
    5000,
    'ws04-hold-once-0001'
  ),
  (select withdrawal_id from ws04_ctx),
  'duplicate hold idempotency key returns the same withdrawal'
);

select is(
  (
    select count(*)::integer
    from public.withdrawal_requests
    where user_id = (select user_a from ws04_ctx)
      and idempotency_key = 'ws04-hold-once-0001'
  ),
  1,
  'hold double-submit does not create a second request'
);

select throws_ok(
  $$
    select public.request_krw_withdrawal(
      (select user_a from ws04_ctx),
      (select destination_a from ws04_ctx),
      16000,
      'ws04-hold-oversize-0003'
    )
  $$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'unconnected fresh general request cannot consume remaining total KRW'
);

update ws04_ctx
set hold_tx = request.hold_ledger_transaction_id
from public.withdrawal_requests as request
where request.id = ws04_ctx.withdrawal_id;

select isnt(
  (select hold_tx from ws04_ctx),
  null,
  'hold posts a balanced ledger transaction'
);

-- External send then ledger finalize retry
update ws04_ctx
set send_id = public.record_krw_external_send(
  withdrawal_id,
  'BANK-REF-WS04-001',
  5000,
  operator_id,
  statement_timestamp(),
  'ws04-krw-send-0001'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'EXTERNAL_SENT_RECORDED',
  'KRW external send records shared EXTERNAL_SENT_RECORDED state'
);

select is(
  public.record_krw_external_send(
    (select withdrawal_id from ws04_ctx),
    'BANK-REF-WS04-001',
    5000,
    (select operator_id from ws04_ctx),
    (select sent_at from public.withdrawal_external_sends where id = (select send_id from ws04_ctx)),
    'ws04-krw-send-0001'
  ),
  (select send_id from ws04_ctx),
  'retry after EXTERNAL_SENT_RECORDED does not create another external send'
);

select throws_ok(
  $$
    select public.release_withdrawal_hold(
      (select withdrawal_id from ws04_ctx),
      (select operator_id from ws04_ctx),
      'too late to release',
      'ws04-release-late-0001',
      'CANCELLED'
    )
  $$,
  '55000',
  'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND',
  'cancel is forbidden after EXTERNAL_SENT_RECORDED'
);

select throws_ok(
  $$
    select public.release_withdrawal_hold(
      (select withdrawal_id from ws04_ctx),
      (select operator_id from ws04_ctx),
      'too late to reject',
      'ws04-release-late-reject',
      'REJECTED'
    )
  $$,
  '55000',
  'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND',
  'reject is forbidden after EXTERNAL_SENT_RECORDED'
);

update ws04_ctx
set finalize_tx = public.finalize_withdrawal_ledger(
  withdrawal_id,
  operator_id,
  'ws04-finalize-0001'
);

select is(
  public.finalize_withdrawal_ledger(
    (select withdrawal_id from ws04_ctx),
    (select operator_id from ws04_ctx),
    'ws04-finalize-0001'
  ),
  (select finalize_tx from ws04_ctx),
  'finalize_withdrawal_ledger is idempotent'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'COMPLETED',
  'finalize completes the withdrawal without another external send'
);

-- CANCELLED release-once path
select throws_ok($general_source$select public.request_krw_withdrawal(
  user_a,
  destination_a,
  3000,
  'ws04-release-once-0001') from ws04_ctx$general_source$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'fresh general request cannot consume unverified total KRW');

-- Historical receipt fixture only; never a verified mining/source producer.
update ws04_ctx
set withdrawal_id = pg_temp.seed_historical_held_withdrawal(
  user_a,
  destination_a,
  3000,
  'ws04-release-once-0001'
);

update ws04_ctx
set release_tx = public.release_withdrawal_hold(
  withdrawal_id,
  operator_id,
  'user cancelled before send',
  'ws04-release-once-key',
  'CANCELLED'
);

select is(
  public.release_withdrawal_hold(
    (select withdrawal_id from ws04_ctx),
    (select operator_id from ws04_ctx),
    'user cancelled before send',
    'ws04-release-once-key',
    'CANCELLED'
  ),
  (select release_tx from ws04_ctx),
  'release_withdrawal_hold runs exactly once under idempotency'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'CANCELLED',
  'user/operator cancellation ends CANCELLED'
);

select is(
  (
    select count(*)::integer
    from public.ledger_transactions
    where idempotency_key = 'ws04-release-once-key:release'
  ),
  1,
  'each release posts exactly one release ledger effect'
);

-- REJECTED is distinct from CANCELLED
select throws_ok($general_source$select public.request_krw_withdrawal(
  user_a,
  destination_a,
  2000,
  'ws04-release-reject-0001') from ws04_ctx$general_source$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'fresh general request cannot consume unverified total KRW');

-- Historical receipt fixture only; never a verified mining/source producer.
update ws04_ctx
set withdrawal_id = pg_temp.seed_historical_held_withdrawal(
  user_a,
  destination_a,
  2000,
  'ws04-release-reject-0001'
);

update ws04_ctx
set release_tx = public.release_withdrawal_hold(
  withdrawal_id,
  operator_id,
  'operator rejected after review',
  'ws04-release-reject-key',
  'REJECTED'
);

select is(
  (
    select status::text
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'REJECTED',
  'operator rejection ends REJECTED'
);

select is(
  public.release_withdrawal_hold(
    (select withdrawal_id from ws04_ctx),
    (select operator_id from ws04_ctx),
    'operator rejected after review',
    'ws04-release-reject-key',
    'REJECTED'
  ),
  (select release_tx from ws04_ctx),
  'rejected release stays idempotent with one effect'
);

-- Replacement destination is protected during cooldown
-- Synthetic verified proof; the production API verifies the password/MFA.
insert into auth.sessions(id,user_id,created_at,updated_at)
select 'd5555555-5555-4555-8555-555555555555',user_a,statement_timestamp(),statement_timestamp() from ws04_ctx;
insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select user_a,'d5555555-5555-4555-8555-555555555555',
  encode(extensions.digest('step-up-token-ws04-a2','sha256'),'hex'),'KRW_BANK',
  encode(extensions.digest('fp-ws04-bank-a-replaced','sha256'),'hex') from ws04_ctx;
update public.withdrawal_destination_step_ups set status='VERIFIED'
where user_id=(select user_a from ws04_ctx) and method='KRW_BANK';
update ws04_ctx
set destination_a = public.register_krw_bank_destination(
  user_a,
  decode('ffeeddccbbaa99887766554433221100', 'hex'),
  encode(extensions.digest('fp-ws04-bank-a-replaced','sha256'),'hex'),
  '국민 **9999',
  'step-up-token-ws04-a2',
  'd4444444-4444-4444-8444-444444444445',
  24
);

select ok(
  (
    select destination.protection_until > statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'replacement KRW_BANK destination is protected during cooldown'
);

select throws_ok(
  $$
    select public.request_krw_withdrawal(
      (select user_a from ws04_ctx),
      (select destination_a from ws04_ctx),
      1000,
      'ws04-protected-dest-0001'
    )
  $$,
  '55000',
  'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'source gate rejects fresh general request before protected destination mutation'
);

-- USDT_ADDRESS first destination + held KRW withdrawal
insert into public.withdrawal_policies (
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select
  'KRW', 'USDT_ADDRESS', 9102, true, 1000, 0,
  '{"allowed_networks":["TRC20"]}'::jsonb,
  statement_timestamp(), operator_id, false
from ws04_ctx;

insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select user_a,'d5555555-5555-4555-8555-555555555555',
  encode(extensions.digest('step-up-token-ws04-usdt2','sha256'),'hex'),'USDT_ADDRESS',
  encode(extensions.digest('fp-ws04-usdt-a2','sha256'),'hex') from ws04_ctx;
update public.withdrawal_destination_step_ups set status='VERIFIED'
where user_id=(select user_a from ws04_ctx) and method='USDT_ADDRESS';
update ws04_ctx
set destination_a = public.register_usdt_withdrawal_destination(
  user_a,
  'TRC20',
  'TXYZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234',
  decode('aabbccddeeff00112233445566778899', 'hex'),
  'fp-ws04-usdt-a',
  'TRC20 TXYZ…1234',
  'step-up-token-ws04-usdt',
  'd4444444-4444-4444-8444-444444444446',
  1
);

select ok(
  (
    select destination.protection_until <= statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'first USDT_ADDRESS destination registration does not apply cooldown'
);

select throws_ok($general_source$select public.request_usdt_withdrawal(
  user_a,
  destination_a,
  1500,
  'ws04-usdt-hold-0001') from ws04_ctx$general_source$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'fresh general request cannot consume unverified total KRW');

-- Historical receipt fixture only; never a verified mining/source producer.
update ws04_ctx
set withdrawal_id = pg_temp.seed_historical_held_withdrawal(
  user_a,
  destination_a,
  1500,
  'ws04-usdt-hold-0001'
);

select ok(
  (
    select hold_ledger_transaction_id is not null
      and currency = 'KRW'
      and destination_type = 'USDT_ADDRESS'
      and status = 'HELD'
    from public.withdrawal_requests
    where id = (select withdrawal_id from ws04_ctx)
  ),
  'normal USDT withdrawal uses held KRW'
);

update ws04_ctx
set destination_a = public.register_usdt_withdrawal_destination(
  user_a,
  'TRC20',
  'TNEWaBcDeFgHiJkLmNoPqRsTuVwXyZ9999',
  decode('99887766554433221100ffeeddccbbaa', 'hex'),
  encode(extensions.digest('fp-ws04-usdt-a2','sha256'),'hex'),
  'TRC20 TNEW…9999',
  'step-up-token-ws04-usdt2',
  'd4444444-4444-4444-8444-444444444447',
  24
);

select ok(
  (
    select destination.protection_until > statement_timestamp()
    from public.withdrawal_destinations as destination
    where destination.id = (select destination_a from ws04_ctx)
  ),
  'replacement USDT_ADDRESS destination is protected during cooldown'
);

-- USDT deposit snapshot stability
update ws04_ctx
set deposit_instruction = public.set_usdt_deposit_instructions(
  'TXYZabcdefghijklmnopqrstuvwxyz123456',
  'TRC20',
  operator_id,
  'initial deposit address for ws04 tests',
  'e5555555-5555-4555-8555-555555555555'
);

update ws04_ctx
set deposit_id = public.submit_usdt_manual_deposit(
  user_a,
  'TRC20',
  '0xabc123deposithash0001',
  12.5,
  'ws04-usdt-deposit-0001'
);

select is(
  (
    select deposit_address_snapshot
    from public.usdt_manual_deposits
    where id = (select deposit_id from ws04_ctx)
  ),
  'TXYZabcdefghijklmnopqrstuvwxyz123456',
  'submit copies deposit_address_snapshot'
);

select ok(
  public.set_usdt_deposit_instructions(
    'TNEWabcdefghijklmnopqrstuvwxyz999999',
    'TRC20',
    (select operator_id from ws04_ctx),
    'rotated deposit address must not rewrite snapshots',
    'e5555555-5555-4555-8555-555555555556'
  ) is not null,
  'deposit instructions can rotate without rewriting snapshots'
);

select is(
  (
    select deposit_address_snapshot
    from public.usdt_manual_deposits
    where id = (select deposit_id from ws04_ctx)
  ),
  'TXYZabcdefghijklmnopqrstuvwxyz123456',
  'instruction rotation does not rewrite past deposit snapshots'
);

update ws04_ctx
set deposit_ledger = public.confirm_usdt_manual_deposit(
  deposit_id,
  15000,
  operator_id,
  'manual confirmation after chain evidence review',
  'ws04-usdt-confirm-0001'
);

select is(
  public.confirm_usdt_manual_deposit(
    (select deposit_id from ws04_ctx),
    15000,
    (select operator_id from ws04_ctx),
    'manual confirmation after chain evidence review',
    'ws04-usdt-confirm-0001'
  ),
  (select deposit_ledger from ws04_ctx),
  'confirm_usdt_manual_deposit posts balanced DEPOSIT once'
);

-- Two-user isolation: user B cannot register against user A destination path
select throws_ok(
  $$
    select public.request_krw_withdrawal(
      (select user_b from ws04_ctx),
      (select destination_a from ws04_ctx),
      1000,
      'ws04-isolation-0001'
    )
  $$,
  '55000',
  'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'user B cannot withdraw using user A destination'
);

select ok(
  not exists (
    select 1
    from public.usdt_deposit_instructions as instruction
    join public.withdrawal_destinations as destination
      on destination.encrypted_value = convert_to(instruction.deposit_address, 'UTF8')
  ),
  'deposit admin addresses are not stored as withdrawal destinations'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.register_admin_session(uuid,text,text,text,integer,integer)',
    'EXECUTE'
  ),
  'service role may register admin sessions'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.open_kyc_case(uuid,uuid)',
    'EXECUTE'
  ),
  'service role may open KYC cases'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_outbox_events(text,integer,integer)',
    'EXECUTE'
  ),
  'worker retains claim_outbox_events'
);

select * from finish();

rollback;
