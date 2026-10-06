begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table source_ctx (
  admin_id uuid, member_id uuid, legacy_id uuid, deposit_id uuid,
  usdt_id uuid, rollback_id uuid, first_source_id uuid, first_effective_at timestamptz,
  program_id uuid, trial_id uuid, conversion_id uuid, collision_deposit_id uuid,
  collision_event_id uuid, collision_event_before jsonb, legacy_deposit_id uuid, audit_deposit_id uuid
);
insert into source_ctx (admin_id, member_id, legacy_id, usdt_id) values (
  '0d460000-0000-4000-8000-0000000000a1',
  '0d460000-0000-4000-8000-000000000101',
  '0d460000-0000-4000-8000-000000000102',
  '0d460000-0000-4000-8000-00000000d001'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'source-admin@putduk.test' as email from source_ctx
  union all select member_id, 'source-member@putduk.test' from source_ctx
  union all select legacy_id, 'source-legacy@putduk.test' from source_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from source_ctx;
select public.bootstrap_user((select member_id from source_ctx));
select public.bootstrap_user((select legacy_id from source_ctx));

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.money_source_movements'::regclass), 'source projection has forced RLS');
select ok(not has_table_privilege('anon', 'public.money_source_movements', 'SELECT')
  and not has_table_privilege('authenticated', 'public.money_source_movements', 'SELECT')
  and not has_table_privilege('authenticated', 'public.money_source_summaries', 'SELECT'),
  'neither public nor member clients enumerate money provenance');
select ok(has_table_privilege('service_role', 'public.money_source_movements', 'SELECT')
  and has_table_privilege('service_role', 'public.money_source_movements', 'INSERT')
  and not has_table_privilege('service_role', 'public.money_source_movements', 'UPDATE')
  and not has_table_privilege('service_role', 'public.money_source_movements', 'DELETE'),
  'server source projection keeps only reviewed read and append privileges');
select ok((select reloptions @> array['security_invoker=true'] from pg_class
  where oid = 'public.money_source_summaries'::regclass), 'summary never bypasses underlying grants');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
  from pg_proc where oid = 'app_private.capture_money_source_credit()'::regprocedure),
  'capture uses invoker authority and a pinned search path');
select ok((select count(*) = 3 and bool_and(tgdeferrable and tginitdeferred)
  from pg_trigger where tgname in ('deposit_requests_money_source_complete',
    'usdt_manual_deposits_money_source_complete', 'trial_reward_conversions_money_source_complete')),
  'all three terminal receipts require deferred transaction completeness');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
  from pg_proc where oid = 'app_private.guard_money_source_terminal_receipt()'::regprocedure)
  and not has_function_privilege('authenticated', 'app_private.guard_money_source_terminal_receipt()', 'EXECUTE'),
  'terminal guard keeps server-only invoker authority');

-- Execute actual frozen commands through the actual service-role privileges.
grant select, update on source_ctx to service_role;
set local role service_role;
update source_ctx set deposit_id = public.create_deposit_request(
  member_id, 'KRW', 3000, 'source-krw-request-v1'
);
select public.approve_deposit_request(deposit_id, admin_id, 3000,
  'source-krw-credit-v1', 'actual fixture bank transfer confirmed', gen_random_uuid()) from source_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'real KRW approval passes terminal completeness with service-role privileges');
set constraints deposit_requests_money_source_complete deferred;
select is((select eligible_principal_atomic from public.money_source_summaries
  where user_id = (select member_id from source_ctx)), '3000', 'server role reads verified principal through the invoker view');
reset role;
update source_ctx set first_source_id = movement.id, first_effective_at = movement.effective_at
from public.money_source_movements as movement where movement.user_id = member_id;
select ok((select movement.source_bucket = 'PRINCIPAL' and movement.origin_code = 'KRW_DEPOSIT'
    and movement.amount_atomic = 3000 and movement.movement_kind = 'CREDIT'
    and movement.wallet_ledger_id = deposit.wallet_ledger_id
    and movement.ledger_transaction_id = deposit.ledger_transaction_id
    and movement.effective_at = journal.posted_at
  from source_ctx as ctx join public.deposit_requests as deposit on deposit.id = ctx.deposit_id
  join public.money_source_movements as movement on movement.id = ctx.first_source_id
  join public.ledger_transactions as journal on journal.id = movement.ledger_transaction_id),
  'real KRW approval captures the same original journal, wallet and effective time');
select is((select eligible_principal_atomic from public.money_source_summaries
  where user_id = (select member_id from source_ctx)), '3000', 'complete fresh provenance exposes exact current principal');

set local role service_role;
select public.approve_deposit_request(deposit_id, admin_id, 3000,
  'source-krw-credit-v1', 'actual fixture bank transfer confirmed', gen_random_uuid()) from source_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'KRW retry retains the original completed source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select is((select count(*)::integer from public.money_source_movements
  where user_id = (select member_id from source_ctx)), 1, 'same command retry cannot duplicate principal');
select ok((select movement.id = ctx.first_source_id and movement.effective_at = ctx.first_effective_at
  from source_ctx as ctx join public.money_source_movements as movement on movement.id = ctx.first_source_id),
  'retry preserves the first effective time');

insert into public.usdt_manual_deposits (
  id, user_id, network, tx_hash, sent_usdt_amount, deposit_address_snapshot, network_snapshot, idempotency_key
)
select usdt_id, member_id, 'TRC20', repeat('6', 64), 10.000001,
  'local-source-fixture-address', 'TRC20', 'source-usdt-request-v1' from source_ctx;
set local role service_role;
select public.confirm_usdt_manual_deposit(usdt_id, 7000, admin_id,
  'actual fixture USDT transfer confirmed', 'source-usdt-credit-v1') from source_ctx;
select lives_ok($$set constraints usdt_manual_deposits_money_source_complete immediate$$,
  'real manual USDT approval passes terminal completeness with service-role privileges');
set constraints usdt_manual_deposits_money_source_complete deferred;
reset role;
select is((select eligible_principal_atomic from public.money_source_summaries
  where user_id = (select member_id from source_ctx)), '10000', 'manual USDT adds approved KRW principal only');
select ok((select source_bucket = 'PRINCIPAL' and origin_code = 'USDT_KRW_DEPOSIT' and amount_atomic = 7000
  from public.money_source_movements where source_event_id = (select id from public.outbox_events
    where aggregate_id = (select usdt_id from source_ctx) and event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1')),
  'USDT transfer receipt creates a KRW source without a USDT economy');
set local role service_role;
select public.confirm_usdt_manual_deposit(usdt_id, 7000, admin_id,
  'actual fixture USDT transfer confirmed', 'source-usdt-credit-v1') from source_ctx;
select lives_ok($$set constraints usdt_manual_deposits_money_source_complete immediate$$,
  'manual USDT retry preserves the original approval actor, amount and source key');
set constraints usdt_manual_deposits_money_source_complete deferred;
reset role;

-- Trial/KYC setup is rollback-only fixture data, with a disabled trial program.
-- Execute the frozen conversion itself as service_role without any funding rule.
with program as (
  insert into public.trial_programs(name, version, is_enabled, duration_seconds,
    quota_bps, target_reward_krw, first_result_target_seconds, first_world_id,
    completion_copy, effective_at)
  select 'source-provenance-fixture', 1, false, 86400, 10000, 5000, 60,
    world.id, '체험을 마쳤어요', statement_timestamp() - interval '2 hours'
  from public.asset_worlds as world where world.code = 'KOREA' returning id
)
update source_ctx set program_id = program.id from program;
with trial as (
  insert into public.trial_accounts(user_id, trial_program_id, trial_program_version,
    world_id, status, started_at, expires_at, last_settled_at, quota_consumed_bps,
    reward_atomic, target_reward_krw)
  select ctx.member_id, ctx.program_id, 1, program.first_world_id, 'COMPLETED',
    statement_timestamp() - interval '1 hour', statement_timestamp(), statement_timestamp(), 10000, 5000, 5000
  from source_ctx as ctx join public.trial_programs as program on program.id = ctx.program_id returning id
)
update source_ctx set trial_id = trial.id from trial;
insert into public.trial_completions(trial_account_id, user_id, reason,
  final_quota_bps, final_reward_atomic, completed_at)
select trial_id, member_id, 'QUOTA', 10000, 5000, statement_timestamp() from source_ctx;
insert into public.kyc_cases(user_id, status, risk_level, decided_at, reviewed_by)
select member_id, 'APPROVED', 'LOW', statement_timestamp(), admin_id from source_ctx;
set local role service_role;
with converted as (
  select * from public.convert_trial_welcome_reward((select member_id from source_ctx),
    'source-welcome-credit-v1', gen_random_uuid(), 1, 'source-fixture-risk-v1')
)
update source_ctx set conversion_id = converted.conversion_id from converted;
select lives_ok($$set constraints trial_reward_conversions_money_source_complete immediate$$,
  'real START conversion passes terminal completeness without a fabricated audit or creator');
set constraints trial_reward_conversions_money_source_complete deferred;
select ok((select coverage = 'COMPLETE' and eligible_principal_atomic = '10000' and recorded_bonus_atomic = '5000'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'service-role START readback excludes the welcome bonus from principal');
select * from public.convert_trial_welcome_reward((select member_id from source_ctx),
  'source-welcome-credit-v1', gen_random_uuid(), 1, 'source-fixture-risk-v1');
select lives_ok($$set constraints trial_reward_conversions_money_source_complete immediate$$,
  'START retry preserves the same original source receipt');
set constraints trial_reward_conversions_money_source_complete deferred;
reset role;
select ok((select journal.created_by is null and projection.created_by is null
  from public.trial_reward_conversions as conversion
  join public.ledger_transactions as journal on journal.id = conversion.ledger_transaction_id
  join public.wallet_ledger as projection on projection.id = conversion.wallet_ledger_id
  where conversion.id = (select conversion_id from source_ctx)),
  'the original START command retains its nullable creator fields');
select is((select count(*)::integer from public.money_source_movements
  where user_id = (select member_id from source_ctx)), 3, 'the three original credits and retries produce three sources');

set local role service_role;
select throws_ok($$
  insert into public.money_source_movements(user_id, source_bucket, movement_kind, origin_code,
    amount_atomic, ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at)
  select user_id, 'BONUS', movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at
  from public.money_source_movements where id = (select first_source_id from source_ctx)
$$, '55000', 'MONEY_SOURCE_RECEIPT_UNVERIFIED', 'a real deposit cannot be reclassified by a raw source insert');
select throws_ok($$
  insert into public.money_source_movements(user_id, source_bucket, movement_kind, origin_code,
    amount_atomic, ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at)
  select (select legacy_id from source_ctx), source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at
  from public.money_source_movements where id = (select first_source_id from source_ctx)
$$, '55000', 'MONEY_SOURCE_RECEIPT_UNVERIFIED', 'foreign member cannot claim another member principal');
select throws_ok($$
  insert into public.money_source_movements(user_id, source_bucket, movement_kind, origin_code,
    amount_atomic, ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at)
  select user_id, source_bucket, 'RESERVE', origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at
  from public.money_source_movements where id = (select first_source_id from source_ctx)
$$, '55000', 'MONEY_SOURCE_COMMAND_NOT_CONNECTED', 'unconnected withdrawal provenance cannot be activated by inserting a row');
select throws_ok($$update public.money_source_movements set amount_atomic = 1$$,
  '42501', null, 'service role cannot overwrite a source amount');
reset role;
select throws_ok($$update public.money_source_movements set amount_atomic = 1$$,
  '55000', 'money_source_movements is append-only', 'owner-level updates also hit the append-only guard');

-- The frozen KRW producer ignores a conflicting outbox key. A different
-- canonical event type is a rollback-only fixture, not a new public event.
set local role service_role;
update source_ctx set collision_deposit_id = public.create_deposit_request(
  member_id, 'KRW', 888, 'source-collision-request-v1');
reset role;
with collision as (
  insert into public.outbox_events(event_type, schema_version, aggregate_type, aggregate_id,
    actor_user_id, payload, correlation_id, request_id, idempotency_key)
  select 'TRIAL_COMPLETED.v1', 1, 'trial_account', trial_id, member_id,
    jsonb_build_object('user_id', member_id, 'fixture', 'preexisting-key-collision'),
    gen_random_uuid(), gen_random_uuid(), 'source-collision-credit-v1:deposit-event'
  from source_ctx returning id, to_jsonb(outbox_events.*) as receipt
)
update source_ctx set collision_event_id = collision.id, collision_event_before = collision.receipt from collision;
set local role service_role;
select throws_ok($test$
  do $body$
  begin
    perform public.approve_deposit_request(collision_deposit_id, admin_id, 888,
      'source-collision-credit-v1', 'actual fixture bank transfer confirmed', gen_random_uuid()) from source_ctx;
    set constraints deposit_requests_money_source_complete immediate;
  end;
  $body$;
$test$, '55000', 'FUNDING_CREDIT_COMMAND_COMPLETION_MISSING',
  'actual service rejects the missing financial/source original before credit completion');
reset role;
-- Trusted postgres fixture preserves the independent original deferred source
-- invariant. The historical owner-only command path skips the private engine
-- hook; it is not an application authority or a restored service privilege.
select throws_ok($test$
  do $body$
  begin
    perform public.approve_deposit_request(collision_deposit_id, admin_id, 888,
      'source-collision-credit-v1', 'actual fixture bank transfer confirmed', gen_random_uuid()) from source_ctx;
    set constraints deposit_requests_money_source_complete immediate;
  end;
  $body$;
$test$, '55000', 'MONEY_SOURCE_CAPTURE_INCOMPLETE',
  'an ignored outbox-key collision rolls back the whole KRW approval at the deferred boundary');
set local role service_role;
reset role;
select ok((select status = 'AWAITING_TRANSFER' and approved_amount_atomic is null
  and reviewed_by is null and ledger_transaction_id is null and wallet_ledger_id is null
  from public.deposit_requests where id = (select collision_deposit_id from source_ctx)),
  'deferred failure preserves the unapproved deposit request');
select ok(not exists(select 1 from public.ledger_transactions
    where reference_id = (select collision_deposit_id from source_ctx) or idempotency_key = 'source-collision-credit-v1:ledger')
  and not exists(select 1 from public.wallet_ledger
    where reference_id = (select collision_deposit_id from source_ctx) or idempotency_key = 'source-collision-credit-v1')
  and not exists(select 1 from public.audit_logs where target_id = (select collision_deposit_id::text from source_ctx))
  and not exists(select 1 from app_private.idempotency_keys
    where scope = 'deposit.approve' and idempotency_key = 'source-collision-credit-v1')
  and not exists(select 1 from public.money_source_movements where source_event_id = (select collision_event_id from source_ctx))
  and not exists(select 1 from public.outbox_events where aggregate_id = (select collision_deposit_id from source_ctx))
  and not exists(select 1 from app_private.funding_credit_boundary_preparations where command_original_id=(select collision_deposit_id from source_ctx)),
  'deferred collision leaves no journal, wallet, audit, command key, source or approval event');
select ok((select to_jsonb(event.*) = ctx.collision_event_before
  from source_ctx as ctx join public.outbox_events as event on event.id = ctx.collision_event_id)
  and (select count(*) = 1 from public.outbox_events where idempotency_key = 'source-collision-credit-v1:deposit-event'),
  'the preexisting collision event remains exactly unchanged');
select is((select count(*)::integer from public.money_source_movements
  where user_id = (select member_id from source_ctx)), 3, 'collision rollback retains only the original three sources');
set local role service_role;
select throws_ok($test$
  do $body$
  begin
    insert into public.deposit_requests(user_id, currency, amount_atomic, status,
      idempotency_key, reviewed_by, reviewed_at, approved_amount_atomic, ledger_transaction_id, wallet_ledger_id)
    select ctx.legacy_id, 'KRW', 3000, 'APPROVED', 'source-forged-terminal-v1', ctx.admin_id,
      statement_timestamp(), 3000, original.ledger_transaction_id, original.wallet_ledger_id
    from source_ctx as ctx join public.deposit_requests as original on original.id = ctx.deposit_id;
    set constraints deposit_requests_money_source_complete immediate;
  end;
  $body$;
$test$, '55000', 'MONEY_SOURCE_CAPTURE_INCOMPLETE',
  'a foreign terminal domain row cannot reuse another original command source');
reset role;
select ok(not exists(select 1 from public.deposit_requests where idempotency_key = 'source-forged-terminal-v1'),
  'the forged terminal row is rolled back rather than accepted as a second domain receipt');

-- Deliberately create ambiguous old wallet evidence in this rollback-only fixture.
insert into public.wallet_ledger(wallet_account_id, user_id, direction, entry_type,
  amount_atomic, idempotency_key, reference_type, reference_id, reason, created_at)
select wallet.id, ctx.legacy_id, 'CREDIT', 'ADMIN_ADJUSTMENT', 99000,
  'source-old-ambiguous-v1', 'legacy_fixture', gen_random_uuid(), 'unknown historical bonus or principal',
  (select introduced_at - interval '1 second' from app_private.money_source_epochs where version = 1)
from source_ctx as ctx join public.wallet_accounts as wallet on wallet.user_id = ctx.legacy_id and wallet.currency = 'KRW';
select is((select coverage from public.money_source_summaries where user_id = (select legacy_id from source_ctx)),
  'UNRESOLVED', 'ambiguous historical wallet evidence stays unresolved');
select ok((select eligible_principal_atomic is null from public.money_source_summaries
  where user_id = (select legacy_id from source_ctx)), 'unknown historical balance is never treated as principal');
select is((select count(*)::integer from public.money_source_movements where user_id = (select legacy_id from source_ctx)),
  0, 'no source backfill occurs for old or ambiguous credits');

-- A complete pre-capture journal is still exempt even when its event or a
-- matching command retry arrives later. Historical audits/keys are not invented.
set local role service_role;
update source_ctx set legacy_deposit_id = public.create_deposit_request(
  legacy_id, 'KRW', 2345, 'source-legacy-request-v1');
-- Bootstrap creates a wallet only. Prepare the actual legacy liability account
-- before the fixture's CREDIT SELECT; an APPROVED retry does not create it.
insert into public.ledger_accounts (
  code, currency, account_class, normal_side, owner_user_id, is_controlled_asset
)
select 'USER:' || upper(legacy_id::text) || ':KRW:LIABILITY',
  'KRW'::public.currency_code, 'LIABILITY'::public.ledger_account_class,
  'CREDIT'::public.ledger_side, legacy_id, false from source_ctx;
reset role;
insert into public.ledger_transactions(category, currency, idempotency_key,
  reference_type, reference_id, member_user_id, request_id, correlation_id,
  description, created_by, posted_at, created_at)
select 'DEPOSIT', 'KRW', 'source-legacy-credit-v1:ledger', 'deposit_request', legacy_deposit_id,
  legacy_id, gen_random_uuid(), gen_random_uuid(), 'pre-capture receipt fixture', admin_id,
  epoch.introduced_at - interval '1 second', epoch.introduced_at - interval '1 second'
from source_ctx cross join app_private.money_source_epochs as epoch where epoch.version = 1;
insert into public.ledger_entries(transaction_id, account_id, sequence, side, amount_atomic)
select journal.id, account.id, 0, 'DEBIT'::public.ledger_side, 2345
from public.ledger_transactions as journal join public.ledger_accounts as account
  on account.code = 'PUTDUK:OPERATING_CASH:KRW' where journal.idempotency_key = 'source-legacy-credit-v1:ledger'
union all
select journal.id, account.id, 1, 'CREDIT'::public.ledger_side, 2345
from source_ctx as ctx join public.ledger_transactions as journal on journal.reference_id = ctx.legacy_deposit_id
join public.ledger_accounts as account on account.code = 'USER:' || upper(ctx.legacy_id::text) || ':KRW:LIABILITY';
select ok((select count(*) = 2
    and count(*) filter (where entry.sequence = 0 and entry.side = 'DEBIT'
      and account.code = 'PUTDUK:OPERATING_CASH:KRW' and account.owner_user_id is null) = 1
    and count(*) filter (where entry.sequence = 1 and entry.side = 'CREDIT'
      and account.code = 'USER:' || upper(ctx.legacy_id::text) || ':KRW:LIABILITY'
      and account.owner_user_id = ctx.legacy_id) = 1
    and bool_and(entry.amount_atomic = 2345 and account.currency = journal.currency)
  from public.ledger_transactions as journal
  join public.ledger_entries as entry on entry.transaction_id = journal.id
  join public.ledger_accounts as account on account.id = entry.account_id
  cross join source_ctx as ctx where journal.idempotency_key = 'source-legacy-credit-v1:ledger'),
  'the pre-capture journal contains both real cash and legacy member legs on the same journal');
set local role service_role;
select lives_ok($$set constraints ledger_entries_balanced_at_commit,
  ledger_transactions_balanced_at_commit immediate$$,
  'all earlier CREDIT3 journals and the complete pre-capture fixture satisfy the original balance guards');
set constraints ledger_entries_balanced_at_commit, ledger_transactions_balanced_at_commit deferred;
reset role;
insert into public.wallet_ledger(wallet_account_id, user_id, direction, entry_type,
  amount_atomic, idempotency_key, reference_type, reference_id, reason, created_by, created_at)
select wallet.id, ctx.legacy_id, 'CREDIT', 'DEPOSIT', 2345, 'source-legacy-credit-v1',
  'deposit_request', ctx.legacy_deposit_id, 'pre-capture receipt fixture', ctx.admin_id, journal.created_at
from source_ctx as ctx join public.wallet_accounts as wallet on wallet.user_id = ctx.legacy_id and wallet.currency = 'KRW'
join public.ledger_transactions as journal on journal.reference_id = ctx.legacy_deposit_id;
update public.deposit_requests as deposit
set status = 'APPROVED', approved_amount_atomic = 2345, reviewed_by = ctx.admin_id,
  reviewed_at = journal.created_at, ledger_transaction_id = journal.id, wallet_ledger_id = projection.id
from source_ctx as ctx, public.ledger_transactions as journal, public.wallet_ledger as projection
where deposit.id = ctx.legacy_deposit_id and journal.reference_id = ctx.legacy_deposit_id
  and projection.reference_id = ctx.legacy_deposit_id;
insert into public.outbox_events(event_type, schema_version, aggregate_type, aggregate_id,
  actor_user_id, payload, correlation_id, request_id, idempotency_key)
select 'DEPOSIT_CONFIRMED.v1', 1, 'deposit_request', ctx.legacy_deposit_id, ctx.admin_id,
  jsonb_build_object('user_id', ctx.legacy_id, 'currency', 'KRW', 'approved_amount_atomic', '2345',
    'requested_amount_atomic', '2345', 'ledger_transaction_id', journal.id, 'wallet_ledger_id', projection.id),
  journal.correlation_id, journal.request_id, 'source-legacy-credit-v1:deposit-event'
from source_ctx as ctx join public.ledger_transactions as journal on journal.reference_id = ctx.legacy_deposit_id
join public.wallet_ledger as projection on projection.reference_id = ctx.legacy_deposit_id;
set local role service_role;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'pre-capture terminal receipts remain compatible without historical audits or command keys');
set constraints deposit_requests_money_source_complete deferred;
select public.approve_deposit_request(legacy_deposit_id, admin_id, 2345,
  'source-legacy-credit-v1', 'pre-capture receipt fixture', gen_random_uuid()) from source_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'a matching legacy KRW retry does not activate prospective provenance');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select is((select count(*)::integer from public.money_source_movements
  where user_id = (select legacy_id from source_ctx)), 0, 'later event and retry do not backfill pre-capture principal');
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null
  from public.money_source_summaries where user_id = (select legacy_id from source_ctx))
  and not exists(select 1 from public.audit_logs where target_id = (select legacy_deposit_id::text from source_ctx)),
  'legacy coverage stays unresolved without a manufactured approval audit');

-- Readback checks the original receipt again, rather than trusting a cached source amount.
update public.outbox_events set payload = jsonb_set(payload, '{approved_amount_atomic}', '"3001"'::jsonb)
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null and invalid_source_receipts = '1'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'a changed original receipt blocks current principal and exposes mismatch coverage');
update public.outbox_events set payload = jsonb_set(payload, '{approved_amount_atomic}', '"3000"'::jsonb)
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
update public.outbox_events set payload = jsonb_set(payload, '{currency}', '"USDT"'::jsonb)
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'a mismatched receipt currency cannot establish KRW principal');
update public.outbox_events set payload = jsonb_set(payload, '{currency}', '"KRW"'::jsonb)
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
update public.outbox_events set payload = jsonb_set(payload, '{wallet_ledger_id}',
  to_jsonb((select legacy_id::text from source_ctx)))
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'a mismatched original wallet receipt cannot establish principal');
update public.outbox_events set payload = jsonb_set(payload, '{wallet_ledger_id}',
  to_jsonb((select wallet_ledger_id::text from public.deposit_requests where id = (select deposit_id from source_ctx))))
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';

update public.outbox_events set actor_user_id = (select legacy_id from source_ctx)
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
set local role service_role;
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null and invalid_source_receipts = '1'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'a foreign receipt actor cannot establish another member principal');
select throws_ok($$select app_private.assert_money_source_credit_complete(movement)
  from public.money_source_movements as movement where id = (select first_source_id from source_ctx)$$,
  '55000', 'MONEY_SOURCE_RECEIPT_UNVERIFIED', 'service-role receipt validation rejects a mismatched original actor');
reset role;
update public.outbox_events set actor_user_id = (select admin_id from source_ctx)
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
update public.outbox_events set idempotency_key = 'source-wrong-receipt-key:deposit-event'
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'a changed event key cannot substitute for the original approval business key');
update public.outbox_events set idempotency_key = 'source-krw-credit-v1:deposit-event'
where aggregate_id = (select deposit_id from source_ctx) and event_type = 'DEPOSIT_CONFIRMED.v1';

-- Service-role commands cannot corrupt an account's posted journal identity.
set local role service_role;
select throws_ok($$update public.ledger_accounts set code = 'PUTDUK:SOURCE_FIXTURE_OTHER_CASH:KRW'
  where code = 'PUTDUK:OPERATING_CASH:KRW'$$,
  '55000', 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE', 'the original command cash account cannot be renamed');
select ok((select coverage = 'COMPLETE' and eligible_principal_atomic = '10000' and invalid_source_receipts = '0'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'rejected account substitution leaves the original money receipts verified');
select throws_ok($$update public.ledger_accounts set is_controlled_asset = false
  where code = 'PUTDUK:OPERATING_CASH:KRW'$$,
  '55000', 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE', 'original controlled-asset semantics cannot be rewritten');
select ok((select coverage = 'COMPLETE' and eligible_principal_atomic = '10000' and invalid_source_receipts = '0'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'rejected asset rewrite leaves the original money receipts verified');
select throws_ok($$update public.ledger_accounts set normal_side = 'CREDIT'
  where code = 'PUTDUK:OPERATING_CASH:KRW'$$,
  '55000', 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE', 'the original asset normal side cannot be rewritten');
select ok((select coverage = 'COMPLETE' and eligible_principal_atomic = '10000' and invalid_source_receipts = '0'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'rejected normal-side rewrite leaves the original money receipts verified');
reset role;

-- Keep defensive readback coverage for historical corrupt originals. Only the
-- table owner can prepare these rollback-only fixtures; restore the named
-- trigger immediately after each fixture edit, before every service-role read.
alter table public.ledger_accounts disable trigger ledger_accounts_identity_immutable;
update public.ledger_accounts set code = 'PUTDUK:SOURCE_FIXTURE_OTHER_CASH:KRW'
where code = 'PUTDUK:OPERATING_CASH:KRW';
alter table public.ledger_accounts enable trigger ledger_accounts_identity_immutable;
set local role service_role;
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null and invalid_source_receipts = '2'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'the same asset class cannot substitute for the original command cash account');
reset role;
alter table public.ledger_accounts disable trigger ledger_accounts_identity_immutable;
update public.ledger_accounts set code = 'PUTDUK:OPERATING_CASH:KRW'
where code = 'PUTDUK:SOURCE_FIXTURE_OTHER_CASH:KRW';
update public.ledger_accounts set is_controlled_asset = false where code = 'PUTDUK:OPERATING_CASH:KRW';
alter table public.ledger_accounts enable trigger ledger_accounts_identity_immutable;
set local role service_role;
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'original controlled-asset semantics remain part of the money receipt');
reset role;
alter table public.ledger_accounts disable trigger ledger_accounts_identity_immutable;
update public.ledger_accounts set is_controlled_asset = true where code = 'PUTDUK:OPERATING_CASH:KRW';
update public.ledger_accounts set normal_side = 'CREDIT' where code = 'PUTDUK:OPERATING_CASH:KRW';
alter table public.ledger_accounts enable trigger ledger_accounts_identity_immutable;
set local role service_role;
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'a changed normal side invalidates the original asset receipt');
reset role;
alter table public.ledger_accounts disable trigger ledger_accounts_identity_immutable;
update public.ledger_accounts set normal_side = 'DEBIT' where code = 'PUTDUK:OPERATING_CASH:KRW';
alter table public.ledger_accounts enable trigger ledger_accounts_identity_immutable;
set local role service_role;
select ok((select coverage = 'COMPLETE' and eligible_principal_atomic = '10000'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'restored original receipts retain exact principal without replacing source history');
reset role;

-- Failure in source capture rolls back the parent money command, not just the projection.
create function app_private.money_source_test_fail_capture()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.user_id = '0d460000-0000-4000-8000-000000000101'::uuid and new.amount_atomic = 777 then
    raise exception using errcode = 'P0001', message = 'SOURCE_CAPTURE_FIXTURE_FAILURE';
  end if;
  return new;
end;
$$;
revoke all on function app_private.money_source_test_fail_capture() from public, anon, authenticated;
grant execute on function app_private.money_source_test_fail_capture() to service_role;
create trigger money_source_test_fail_capture before insert on public.money_source_movements
for each row execute function app_private.money_source_test_fail_capture();
set local role service_role;
update source_ctx set rollback_id = public.create_deposit_request(member_id, 'KRW', 777, 'source-rollback-request-v1');
select throws_ok($$select public.approve_deposit_request(rollback_id, admin_id, 777,
  'source-rollback-credit-v1', 'actual fixture transfer rolls back', gen_random_uuid()) from source_ctx$$,
  'P0001', 'SOURCE_CAPTURE_FIXTURE_FAILURE', 'capture failure rolls back the actual approval transaction');
reset role;
select ok((select status = 'AWAITING_TRANSFER' and ledger_transaction_id is null and wallet_ledger_id is null
  from public.deposit_requests where id = (select rollback_id from source_ctx)), 'failed capture leaves deposit unapproved');
select ok(not exists(select 1 from public.ledger_transactions where reference_id = (select rollback_id from source_ctx))
  and not exists(select 1 from public.wallet_ledger where reference_id = (select rollback_id from source_ctx))
  and not exists(select 1 from public.outbox_events where aggregate_id = (select rollback_id from source_ctx))
  and not exists(select 1 from public.audit_logs where target_id = (select rollback_id::text from source_ctx))
  and not exists(select 1 from app_private.idempotency_keys
    where scope = 'deposit.approve' and idempotency_key = 'source-rollback-credit-v1'),
  'failed capture leaves no journal, wallet, outbox, success audit or command key');

-- Dropping only the later success audit must also roll back a captured credit.
create function app_private.money_source_test_suppress_audit()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.action = 'deposit.approve' and new.reason = 'source fixture suppressed approval audit' then return null; end if;
  return new;
end;
$$;
revoke all on function app_private.money_source_test_suppress_audit() from public, anon, authenticated;
grant execute on function app_private.money_source_test_suppress_audit() to service_role;
create trigger money_source_test_suppress_audit before insert on public.audit_logs
for each row execute function app_private.money_source_test_suppress_audit();
set local role service_role;
update source_ctx set audit_deposit_id = public.create_deposit_request(member_id, 'KRW', 555, 'source-audit-request-v1');
select throws_ok($test$
  do $body$
  begin
    perform public.approve_deposit_request(audit_deposit_id, admin_id, 555,
      'source-audit-credit-v1', 'source fixture suppressed approval audit', gen_random_uuid()) from source_ctx;
    set constraints deposit_requests_money_source_complete immediate;
  end;
  $body$;
$test$, '55000', 'FUNDING_CREDIT_COMMAND_COMPLETION_MISSING',
  'actual service rejects a suppressed approval audit before credit completion');
reset role;
-- Trusted postgres fixture preserves the independent original deferred source
-- invariant. The historical owner-only command path skips the private engine
-- hook; it is not an application authority or a restored service privilege.
select throws_ok($test$
  do $body$
  begin
    perform public.approve_deposit_request(audit_deposit_id, admin_id, 555,
      'source-audit-credit-v1', 'source fixture suppressed approval audit', gen_random_uuid()) from source_ctx;
    set constraints deposit_requests_money_source_complete immediate;
  end;
  $body$;
$test$, '55000', 'MONEY_SOURCE_RECEIPT_UNVERIFIED',
  'terminal completeness rejects a captured credit without its original approval audit');
set local role service_role;
reset role;
select ok((select status = 'AWAITING_TRANSFER' and ledger_transaction_id is null and wallet_ledger_id is null
    from public.deposit_requests where id = (select audit_deposit_id from source_ctx))
  and not exists(select 1 from public.ledger_transactions where idempotency_key = 'source-audit-credit-v1:ledger')
  and not exists(select 1 from public.wallet_ledger where idempotency_key = 'source-audit-credit-v1')
  and not exists(select 1 from public.outbox_events where aggregate_id = (select audit_deposit_id from source_ctx))
  and not exists(select 1 from public.audit_logs where target_id = (select audit_deposit_id::text from source_ctx))
  and not exists(select 1 from app_private.idempotency_keys
    where scope = 'deposit.approve' and idempotency_key = 'source-audit-credit-v1')
  and not exists(select 1 from app_private.funding_credit_boundary_preparations where command_original_id=(select audit_deposit_id from source_ctx)),
  'missing audit rolls back the domain, journal, wallet, source event and completed key');
select is((select count(*)::integer from public.money_source_movements
  where user_id = (select member_id from source_ctx)), 3, 'audit failure does not leave an orphan captured source');
set local role service_role;
select lives_ok($$set constraints deposit_requests_money_source_complete,
  usdt_manual_deposits_money_source_complete, trial_reward_conversions_money_source_complete immediate$$,
  'all remaining terminal guards execute explicitly before this rollback-only test finishes');
reset role;

-- Header ownership can be absent or wrong while real member accounts still move.
-- These balanced debits are unknown provenance, never newly inferred principal.
set local role service_role;
with inserted as (
  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, created_by
  )
  select 'ADMIN_ADJUSTMENT', 'KRW', 'source-null-header-adjustment-v1',
    'source_fixture', gen_random_uuid(), null, gen_random_uuid(), gen_random_uuid(),
    'balanced fixture debit with no member header', admin_id from source_ctx
  returning id
)
insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
select inserted.id, account.id, leg.sequence, leg.side::public.ledger_side, 1000
from inserted cross join source_ctx as ctx
cross join (values (0::smallint, 'DEBIT'::public.ledger_side, true), (1::smallint, 'CREDIT'::public.ledger_side, false))
  as leg(sequence, side, member_account)
join public.ledger_accounts as account on account.code = case when leg.member_account
  then 'USER:' || upper(ctx.member_id::text) || ':KRW:LIABILITY'
  else 'PUTDUK:OPERATING_CASH:KRW' end;
select lives_ok($$set constraints ledger_entries_balanced_at_commit,
  ledger_transactions_balanced_at_commit immediate$$,
  'a headerless member debit is an actual balanced journal through service-role authority');
set constraints ledger_entries_balanced_at_commit, ledger_transactions_balanced_at_commit deferred;
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null
    and unclassified_journals = '1' and unclassified_wallet_entries = '0' and invalid_source_receipts = '0'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'actual KRW account ownership detects a journal even when its member header is NULL');

with inserted as (
  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, created_by
  )
  select 'ADMIN_ADJUSTMENT', 'KRW', 'source-foreign-header-adjustment-v1',
    'source_fixture', gen_random_uuid(), legacy_id, gen_random_uuid(), gen_random_uuid(),
    'balanced fixture debit with another member header', admin_id from source_ctx
  returning id
)
insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
select inserted.id, account.id, leg.sequence, leg.side::public.ledger_side, 1000
from inserted cross join source_ctx as ctx
cross join (values (0::smallint, 'DEBIT'::public.ledger_side, true), (1::smallint, 'CREDIT'::public.ledger_side, false))
  as leg(sequence, side, member_account)
join public.ledger_accounts as account on account.code = case when leg.member_account
  then 'USER:' || upper(ctx.member_id::text) || ':KRW:LIABILITY'
  else 'PUTDUK:OPERATING_CASH:KRW' end;
select lives_ok($$set constraints ledger_entries_balanced_at_commit,
  ledger_transactions_balanced_at_commit immediate$$,
  'a debit with a foreign member header also passes the original balanced-ledger guard');
set constraints ledger_entries_balanced_at_commit, ledger_transactions_balanced_at_commit deferred;
select ok((select coverage = 'UNRESOLVED' and eligible_principal_atomic is null and unclassified_journals = '2'
  from public.money_source_summaries where user_id = (select member_id from source_ctx)),
  'another member header cannot hide a debit from the actual account owner coverage');
select ok((select count(*) = 3 from public.money_source_movements where user_id = (select member_id from source_ctx))
  and not exists (select 1 from public.wallet_ledger
    where idempotency_key in ('source-null-header-adjustment-v1', 'source-foreign-header-adjustment-v1'))
  and not exists (select 1 from public.money_source_movements as movement
    join public.ledger_transactions as journal on journal.id = movement.ledger_transaction_id
    where journal.idempotency_key in ('source-null-header-adjustment-v1', 'source-foreign-header-adjustment-v1')),
  'balanced unknown journals do not manufacture wallet or source receipts');
reset role;

select * from finish();
rollback;
