begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

create temporary table test_context (
  user_id uuid not null,
  program_id uuid,
  curve_id uuid,
  session_id uuid
);

insert into test_context (user_id)
values ('9fb9207f-9a43-4a0d-8bd7-3f453c50420e');

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
  updated_at
)
select
  user_id,
  'authenticated',
  'authenticated',
  'trial-settlement@putduk.test',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
from test_context;

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
    'PGTAP_TRIAL',
    1,
    false,
    3600,
    3000,
    60,
    world.id,
    '테스트 체험 완료',
    statement_timestamp() - interval '4 hours'
  from public.asset_worlds as world
  where world.code = 'KOREA'
  returning id
)
update test_context
set program_id = inserted.id
from inserted;

with inserted as (
  insert into public.trial_reward_curves (
    trial_program_id,
    version,
    effective_at
  )
  select context.program_id, 1, program.effective_at
  from test_context as context
  join public.trial_programs as program on program.id = context.program_id
  returning id
)
update test_context
set curve_id = inserted.id
from inserted;

insert into public.trial_reward_curve_points (
  trial_reward_curve_id,
  sequence,
  elapsed_seconds,
  cumulative_quota_bps,
  cumulative_reward_bps
)
select curve_id, 0, 0, 0, 0 from test_context
union all
select curve_id, 1, 1800, 5000, 5000 from test_context
union all
select curve_id, 2, 3600, 10000, 10000 from test_context;

update public.trial_programs
set is_enabled = true
where id = (select program_id from test_context);

select ok(
  (select is_enabled from public.trial_programs where id = (select program_id from test_context)),
  'a complete monotonic trial curve can be enabled'
);

update test_context
set session_id = public.start_trial(user_id, 'pgtap-trial-start-0001');

select isnt(
  (select session_id from test_context),
  null,
  'start_trial creates a server-side session'
);

update public.trial_accounts
set
  started_at = statement_timestamp() - interval '30 minutes',
  expires_at = statement_timestamp() + interval '30 minutes',
  last_settled_at = statement_timestamp() - interval '30 minutes'
where user_id = (select user_id from test_context);

update public.trial_sessions
set
  started_at = statement_timestamp() - interval '30 minutes',
  last_settled_at = statement_timestamp() - interval '30 minutes'
where id = (select session_id from test_context);

create temporary table first_settlement as
select *
from public.settle_trial(
  (select user_id from test_context),
  'pgtap-trial-settle-0001'
);

select is(
  (select status::text from first_settlement),
  'ACTIVE',
  'midpoint settlement keeps the trial active'
);

select ok(
  (select quota_consumed_bps between 5000 and 5001 from first_settlement),
  'midpoint settlement interpolates quota from server elapsed time'
);

select ok(
  (select reward_atomic between 1500 and 1501 from first_settlement),
  'midpoint settlement interpolates the configured reward curve'
);

select is(
  (
    select count(*)::integer
    from public.trial_ledger
    where user_id = (select user_id from test_context)
  ),
  1,
  'trial settlement creates one append-only ledger delta'
);

select public.settle_trial(
  (select user_id from test_context),
  'pgtap-trial-settle-0001'
);

select is(
  (
    select count(*)::integer
    from public.trial_ledger
    where user_id = (select user_id from test_context)
  ),
  1,
  'repeating an idempotency key does not duplicate the trial ledger'
);

update public.trial_accounts
set
  started_at = statement_timestamp() - interval '1 hour',
  expires_at = statement_timestamp(),
  last_settled_at = statement_timestamp() - interval '30 minutes'
where user_id = (select user_id from test_context);

update public.trial_sessions
set
  started_at = statement_timestamp() - interval '1 hour',
  last_settled_at = statement_timestamp() - interval '30 minutes'
where id = (select session_id from test_context);

create temporary table final_settlement as
select *
from public.settle_trial(
  (select user_id from test_context),
  'pgtap-trial-settle-0002'
);

select is(
  (select status::text from final_settlement),
  'COMPLETED',
  'the configured duration completes the trial'
);

select is(
  (select reward_atomic from final_settlement),
  3000::bigint,
  'completion reaches the operator-configured target reward'
);

select * from finish();

rollback;
