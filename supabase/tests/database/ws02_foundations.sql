begin;

create extension if not exists pgtap with schema extensions;

select plan(53);

select has_table('public', 'ledger_accounts', 'balanced ledger accounts exist');
select has_table('public', 'ledger_transactions', 'balanced ledger headers exist');
select has_table('public', 'ledger_entries', 'balanced ledger lines exist');
select has_table('public', 'outbox_events', 'transactional outbox exists');
select has_table('public', 'promotion_campaigns', 'promotion campaign model exists');
select has_table('public', 'product_catalog_versions', 'versioned product catalog exists');
select has_table('public', 'kyc_cases', 'KYC case model exists');
select has_table('public', 'withdrawal_destinations', 'protected withdrawal destinations exist');
select has_table('public', 'reconciliation_runs', 'reconciliation run model exists');

select ok(
  not has_table_privilege('authenticated', 'public.ledger_entries', 'INSERT'),
  'authenticated clients cannot write the authoritative ledger'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.convert_trial_welcome_reward(uuid,text,uuid,integer,text)',
    'EXECUTE'
  ),
  'service role may convert a qualified welcome reward'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.convert_trial_welcome_reward(uuid,text,uuid,integer,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot directly convert welcome rewards'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_welcome_reward_withdrawal_request(uuid,uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'service role may create a verified welcome withdrawal'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_welcome_reward_withdrawal_request(uuid,uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the welcome withdrawal command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_outbox_events(text,integer,integer)',
    'EXECUTE'
  ),
  'service workers may claim outbox leases'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_outbox_events(text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot claim outbox leases'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_system_jobs(text,integer,integer)',
    'EXECUTE'
  ),
  'service workers may claim durable jobs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_system_jobs(text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot claim durable jobs'
);

select is(
  (
    select status::text
    from public.product_catalog_versions
    where version = 1
  ),
  'DRAFT',
  'AI-assisted launch catalog remains an unpublished draft'
);
select is(
  (
    select count(*)::integer
    from public.mining_products
    where catalog_version_id = '20000000-0000-4000-8000-000000000001'
  ),
  11,
  'the neutral catalog proposal covers eleven products'
);
select is(
  (
    select count(*)::integer
    from public.product_rule_versions
    where product_id in (
      select id
      from public.mining_products
      where catalog_version_id = '20000000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'the catalog seed does not invent production economic rules'
);

create temporary table ws02_context (
  user_id uuid not null,
  operator_id uuid not null,
  program_id uuid,
  trial_account_id uuid,
  conversion_id uuid,
  ledger_transaction_id uuid,
  converted_amount_atomic bigint,
  policy_id uuid,
  destination_id uuid,
  withdrawal_id uuid,
  job_id uuid
);

insert into ws02_context (user_id, operator_id)
values (
  'f2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select
  id,
  'authenticated',
  'authenticated',
  email,
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select user_id as id, 'ws02-member@putduk.test' as email from ws02_context
  union all
  select operator_id, 'ws02-operator@putduk.test' from ws02_context
) as identities;

select public.bootstrap_user((select user_id from ws02_context));

with inserted as (
  insert into public.trial_programs (
    name,
    version,
    is_enabled,
    duration_seconds,
    target_reward_krw,
    first_result_target_seconds,
    first_world_id,
    completion_copy,
    effective_at
  )
  select
    'WS02_WELCOME',
    1,
    false,
    3600,
    9000,
    60,
    world.id,
    '테스트 체험 완료',
    statement_timestamp() - interval '2 hours'
  from public.asset_worlds as world
  where world.code = 'KOREA'
  returning id
)
update ws02_context set program_id = inserted.id from inserted;

with inserted as (
  insert into public.trial_accounts (
    user_id,
    trial_program_id,
    trial_program_version,
    world_id,
    status,
    started_at,
    expires_at,
    last_settled_at,
    quota_consumed_bps,
    reward_atomic,
    target_reward_krw
  )
  select
    context.user_id,
    context.program_id,
    1,
    world.id,
    'COMPLETED',
    statement_timestamp() - interval '1 hour',
    statement_timestamp(),
    statement_timestamp(),
    10000,
    9000,
    9000
  from ws02_context as context
  join public.asset_worlds as world on world.code = 'KOREA'
  returning id
)
update ws02_context set trial_account_id = inserted.id from inserted;

insert into public.trial_completions (
  trial_account_id,
  user_id,
  reason,
  final_quota_bps,
  final_reward_atomic,
  completed_at
)
select trial_account_id, user_id, 'QUOTA', 10000, 9000, statement_timestamp()
from ws02_context;

insert into public.kyc_cases (user_id, status, risk_level, decided_at, reviewed_by)
select user_id, 'APPROVED', 'LOW', statement_timestamp(), operator_id
from ws02_context;

create temporary table ws02_conversion as
select *
from public.convert_trial_welcome_reward(
  (select user_id from ws02_context),
  'ws02-welcome-conversion-0001',
  'f2000000-0000-4000-8000-000000000003',
  1,
  'ws02-risk-v1'
);

update ws02_context
set
  conversion_id = conversion.conversion_id,
  ledger_transaction_id = conversion.ledger_transaction_id,
  converted_amount_atomic = conversion.converted_amount_atomic
from ws02_conversion as conversion;

set constraints ledger_entries_balanced_at_commit,
  ledger_transactions_balanced_at_commit immediate;

select is(
  (select converted_amount_atomic from ws02_context),
  5000::bigint,
  'the real welcome conversion is hard-capped at 5,000 KRW'
);
select is(
  (
    select eligible_amount_atomic
    from public.trial_reward_conversions
    where id = (select conversion_id from ws02_context)
  ),
  9000::bigint,
  'conversion evidence retains the full trial reward before the cash cap'
);
select ok(
  (
    select not funding_required and status = 'CONVERTED'
    from public.trial_reward_conversions
    where id = (select conversion_id from ws02_context)
  ),
  'welcome conversion records that funding is never required'
);
select ok(
  (
    select
      sum(amount_atomic) filter (where side = 'DEBIT')
      = sum(amount_atomic) filter (where side = 'CREDIT')
    from public.ledger_entries
    where transaction_id = (select ledger_transaction_id from ws02_context)
  ),
  'welcome conversion posts a balanced authoritative journal'
);

-- Restore deferred balance checks so later WS-04 hold scenarios can insert
-- a ledger header before entries in the same transaction.
set constraints ledger_entries_balanced_at_commit,
  ledger_transactions_balanced_at_commit deferred;

select is(
  (
    select count(*)::integer
    from public.wallet_ledger
    where reference_id = (select conversion_id from ws02_context)
      and entry_type = 'TRIAL_REWARD_CONVERSION'
  ),
  1,
  'welcome conversion creates exactly one wallet projection entry'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events
    where aggregate_id = (select conversion_id from ws02_context)
      and event_type = 'TRIAL_REWARD_CONVERTED.v1'
  ),
  1,
  'welcome conversion emits one versioned transactional event'
);
select ok((select source_bucket = 'BONUS' and origin_code = 'WELCOME_REWARD' and amount_atomic = 5000
  from public.money_source_movements where ledger_transaction_id = (select ledger_transaction_id from ws02_context)),
  'real START conversion records BONUS provenance and never principal');
select is((select eligible_principal_atomic from public.money_source_summaries
  where user_id = (select user_id from ws02_context)), '0',
  'a real welcome reward does not create eligible funding principal');
select is(
  (
    select count(*)::integer
    from public.deposit_requests
    where user_id = (select user_id from ws02_context)
  ),
  0,
  'welcome conversion does not create or require funding'
);

select *
from public.convert_trial_welcome_reward(
  (select user_id from ws02_context),
  'ws02-welcome-conversion-0001',
  'f2000000-0000-4000-8000-000000000003',
  1,
  'ws02-risk-v1'
);

select is(
  (
    select count(*)::integer
    from public.trial_reward_conversions
    where user_id = (select user_id from ws02_context)
  ),
  1,
  'conversion replay cannot duplicate the one-time reward'
);

with inserted as (
  insert into public.withdrawal_policies (
    currency,
    destination_type,
    version,
    is_enabled,
    minimum_amount_atomic,
    fee_atomic,
    destination_config,
    effective_at,
    approved_by,
    allows_welcome_reward
  )
  select
    'KRW',
    'KRW_BANK',
    99,
    true,
    1,
    0,
    '{"country":"KR","purpose":"welcome_reward"}'::jsonb,
    statement_timestamp() - interval '1 hour',
    operator_id,
    true
  from ws02_context
  returning id
)
update ws02_context set policy_id = inserted.id from inserted;

with inserted as (
  insert into public.withdrawal_destinations (
    user_id,
    destination_type,
    encrypted_value,
    value_fingerprint,
    display_hint,
    verification_status,
    verified_at,
    protection_until
  )
  select
    user_id,
    'KRW_BANK',
    decode('00112233', 'hex'),
    'ws02-bank-fingerprint',
    '***-**-1234',
    'VERIFIED',
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day'
  from ws02_context
  returning id
)
update ws02_context set destination_id = inserted.id from inserted;

update ws02_context
set withdrawal_id = public.create_welcome_reward_withdrawal_request(
  user_id,
  conversion_id,
  policy_id,
  destination_id,
  'ws02-welcome-withdrawal-0001',
  'f2000000-0000-4000-8000-000000000004'
);

select isnt(
  (select withdrawal_id from ws02_context),
  null,
  'a verified welcome withdrawal is created without funding'
);
select ok(
  (
    select request.amount_atomic = 5000
      and request.fee_atomic = 0
      and request.status = 'HELD'
      and request.hold_ledger_transaction_id is not null
    from public.withdrawal_requests as request
    where request.id = (select withdrawal_id from ws02_context)
  ),
  'welcome withdrawal preserves the converted amount and zero fee'
);
select is(
  (
    select count(*)::integer
    from public.deposit_requests
    where user_id = (select user_id from ws02_context)
  ),
  0,
  'first withdrawal remains independent of any deposit record'
);
select is(
  (
    select count(*)::integer
    from public.transaction_receipts
    where user_id = (select user_id from ws02_context)
      and transaction_type = 'WELCOME_REWARD_WITHDRAWAL'
  ),
  1,
  'welcome withdrawal creates a member-visible receipt'
);
select is(
  public.create_welcome_reward_withdrawal_request(
    (select user_id from ws02_context),
    (select conversion_id from ws02_context),
    (select policy_id from ws02_context),
    (select destination_id from ws02_context),
    'ws02-welcome-withdrawal-0001',
    'f2000000-0000-4000-8000-000000000004'
  ),
  (select withdrawal_id from ws02_context),
  'withdrawal replay returns the existing request'
);

create temporary table ws02_reconciliation as
select public.run_financial_reconciliation(
  'f2000000-0000-4000-8000-000000000008'
) as run_id;

select is(
  (
    select run.mismatch_count
    from public.reconciliation_runs as run
    join ws02_reconciliation as result on result.run_id = run.id
  ),
  0::bigint,
  'financial reconciliation finds no mismatch after the welcome flow'
);

create temporary table ws02_claimed_outbox as
select * from public.claim_outbox_events('ws02-worker', 10, 60);

select is(
  (select count(*)::integer from ws02_claimed_outbox),
  2,
  'worker lease claims both transactionally produced events'
);
select ok(
  (select bool_and(status = 'PROCESSING') from ws02_claimed_outbox),
  'claimed outbox events enter PROCESSING under a lease'
);
create temporary table ws02_source_ack_before as select count(*)::bigint as ledger_count from public.ledger_transactions;

-- The canonical original consumer requires both SQL and JWT service identity.
-- The producer and lease above remain the existing public commands.
grant select on ws02_claimed_outbox to service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.complete_outbox_event(
  (select id from ws02_claimed_outbox where event_type='TRIAL_REWARD_CONVERTED.v1'),
  'ws02-worker'
);
reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{}', true);
select is(
  (
    select status::text
    from public.outbox_events
    where id = (select id from ws02_claimed_outbox where event_type='TRIAL_REWARD_CONVERTED.v1')
  ),
  'PROCESSED',
  'the owning worker can complete its outbox lease'
);

with inserted as (
  insert into public.system_jobs (
    job_type,
    idempotency_key,
    payload,
    max_attempts,
    priority
  ) values (
    'WS02_TEST_JOB',
    'ws02-system-job-0001',
    '{"version":1}'::jsonb,
    2,
    10
  )
  returning id
)
update ws02_context set job_id = inserted.id from inserted;

-- Exercise actual worker commands with both SQL and synthetic JWT service identity.
do $temp_grant$
begin
  execute format('grant usage, create on schema %I to service_role',
    (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end;
$temp_grant$;
grant select on ws02_context to service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
create temporary table ws02_claimed_job as
select * from public.claim_system_jobs('ws02-job-worker', 1, 60);

select is(
  (
    select status::text
    from ws02_claimed_job
    where id = (select job_id from ws02_context)
  ),
  'RUNNING',
  'durable job claim moves the selected job to RUNNING'
);
select is(
  (
    select count(*)::integer
    from public.system_job_attempts
    where job_id = (select job_id from ws02_context)
  ),
  1,
  'durable job claim records its first attempt'
);
select is(
  public.fail_system_job(
    (select job_id from ws02_context),
    'ws02-job-worker',
    'TRANSIENT_TEST',
    'TRANSIENT',
    0
  )::text,
  'FAILED',
  'a retryable job failure returns the job to FAILED'
);

create temporary table ws02_reclaimed_job as
select * from public.claim_system_jobs('ws02-job-worker-2', 1, 60);

select is(
  (
    select attempts
    from ws02_reclaimed_job
    where id = (select job_id from ws02_context)
  ),
  2,
  'a failed job can be reclaimed for its bounded second attempt'
);
select public.complete_system_job(
  (select job_id from ws02_context),
  'ws02-job-worker-2'
);
select is(
  (
    select status::text
    from public.system_jobs
    where id = (select job_id from ws02_context)
  ),
  'SUCCEEDED',
  'the second lease owner can complete the durable job'
);
reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{}', true);

select throws_ok(
  $sql$
    insert into public.outbox_events (
      event_type,
      schema_version,
      aggregate_type,
      aggregate_id,
      payload,
      correlation_id,
      request_id,
      idempotency_key
    ) values (
      'VERSION_MISMATCH.v2',
      1,
      'test',
      'f2000000-0000-4000-8000-000000000005',
      '{}'::jsonb,
      'f2000000-0000-4000-8000-000000000006',
      'f2000000-0000-4000-8000-000000000007',
      'ws02-invalid-version-event'
    )
  $sql$,
  '23514',
  null,
  'outbox event name version must match schema_version'
);

select throws_ok(
  format(
    $sql$
      insert into public.referral_program_versions (
        version,
        stage_1_reward_atomic,
        stage_2_reward_atomic,
        rule_payload,
        effective_at,
        approved_by
      ) values (999, 5001, 5000, '{}'::jsonb, statement_timestamp(), %L::uuid)
    $sql$,
    (select operator_id from ws02_context)
  ),
  '23514',
  null,
  'standard referral rewards cannot exceed the 10,000 KRW pair cap'
);

-- Default-disabled reward evaluation must not prevent sealed START delivery.
select is((select count(*) from app_private.nonmoney_executor_configuration),0::bigint,
 'ordinary source delivery never implicitly activates local reward configuration');
select is((select count(*) from public.member_event_awards where user_id=(select user_id from ws02_context)),0::bigint,
 'default-disabled source acknowledgement produces no member reward');
select is((select count(*) from public.event_consumer_deliveries where event_id=(select id from ws02_claimed_outbox where event_type='TRIAL_REWARD_CONVERTED.v1')and consumer_name='nonmoney_mission_original.v1'and status='SUCCEEDED'),1::bigint,
 'valid START source commits one delivery receipt without a reward policy');
select is((select count(*) from public.ledger_transactions),
 (select ledger_count from ws02_source_ack_before),
 'source acknowledgement never creates a monetary ledger transaction');
create temporary table ws02_forged_source(id uuid);
insert into ws02_forged_source values(gen_random_uuid());
select throws_ok($$
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,payload,correlation_id,request_id,idempotency_key,status,lease_owner,lease_expires_at)
 select id,'TRIAL_REWARD_CONVERTED.v1',1,'trial_reward_conversion',gen_random_uuid(),'{}',gen_random_uuid(),gen_random_uuid(),'ws02-forged-source','PROCESSING','ws02-invalid',clock_timestamp()+interval '60 seconds'from ws02_forged_source
$$,'55000','MONEY_SOURCE_RECEIPT_UNVERIFIED',
 'default-disabled reward config never allows an outbox-only forged source');
select is((select count(*) from public.event_consumer_deliveries where event_id=(select id from ws02_forged_source)),0::bigint,
 'failed sealed source validation leaves no acknowledgement receipt');
select set_config('request.jwt.claims','{}',true);

select * from finish();

rollback;
