begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

create temporary table ai_test_context (
  user_id uuid not null,
  first_request_id uuid,
  second_request_id uuid
);

insert into ai_test_context (user_id)
values ('316f9846-5084-4bdd-a5a2-e77060487220');

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
  user_id,
  'authenticated',
  'authenticated',
  'ai-orchestration@putduk.test',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
from ai_test_context;

create temporary table first_ai_admission as
select *
from public.begin_ai_request(
  (select user_id from ai_test_context),
  'd6d23bbf-3f62-4f59-868b-bf9ceca7e746',
  repeat('a', 64),
  '{"character_count": 18, "locale": "ko-KR"}'::jsonb,
  'approved-model',
  '2026.09-foundation',
  5,
  100
);

update ai_test_context
set first_request_id = (select request_id from first_ai_admission);

select ok(
  (select is_new from first_ai_admission),
  'the first client message is admitted as a new AI request'
);

select is(
  (
    select count(*)::integer
    from public.ai_requests
    where user_id = (select user_id from ai_test_context)
  ),
  1,
  'AI admission creates exactly one server-owned request row'
);

create temporary table duplicate_ai_admission as
select *
from public.begin_ai_request(
  (select user_id from ai_test_context),
  'd6d23bbf-3f62-4f59-868b-bf9ceca7e746',
  repeat('a', 64),
  '{"character_count": 18, "locale": "ko-KR"}'::jsonb,
  'approved-model',
  '2026.09-foundation',
  5,
  100
);

select ok(
  (
    select not is_new
      and request_id = (select first_request_id from ai_test_context)
    from duplicate_ai_admission
  ),
  'a repeated client message id returns the original request without reinsertion'
);

select throws_ok(
  format(
    $query$
      select * from public.begin_ai_request(
        %L::uuid,
        '18461f35-5ef4-45af-876a-3fb169c01836'::uuid,
        repeat('b', 64),
        '{"character_count": 12}'::jsonb,
        'approved-model',
        '2026.09-foundation',
        1,
        100
      )
    $query$,
    (select user_id from ai_test_context)
  ),
  'P0001',
  'AI_RATE_LIMITED_MINUTE',
  'concurrent-safe minute admission limits reject excess requests'
);

select lives_ok(
  format(
    $query$
      select public.complete_ai_request(
        %L::uuid,
        %L::uuid,
        'resp_pgtap_001',
        'approved-model-2026-09-01',
        120,
        48,
        20,
        260
      )
    $query$,
    (select first_request_id from ai_test_context),
    (select user_id from ai_test_context)
  ),
  'a running AI request can complete with bounded usage metadata'
);

select is(
  (
    select status::text
    from public.ai_requests
    where id = (select first_request_id from ai_test_context)
  ),
  'SUCCEEDED',
  'completion writes the terminal success state'
);

select ok(
  (
    select input_tokens = 120
      and output_tokens = 48
      and cached_input_tokens = 20
      and model_key = 'approved-model-2026-09-01'
    from public.ai_usage
    where request_id = (select first_request_id from ai_test_context)
  ),
  'completion writes the exact provider usage record'
);

select lives_ok(
  format(
    $query$
      select public.complete_ai_request(
        %L::uuid,
        %L::uuid,
        'resp_pgtap_001',
        'approved-model-2026-09-01',
        120,
        48,
        20,
        260
      )
    $query$,
    (select first_request_id from ai_test_context),
    (select user_id from ai_test_context)
  ),
  'repeating a verified completion is idempotent'
);

select is(
  (
    select count(*)::integer
    from public.ai_usage
    where request_id = (select first_request_id from ai_test_context)
  ),
  1,
  'an idempotent completion never duplicates token usage'
);

with admitted as (
  select *
  from public.begin_ai_request(
    (select user_id from ai_test_context),
    '6b668655-45b6-496d-a978-1b3b9e145a16',
    repeat('c', 64),
    '{"character_count": 21}'::jsonb,
    'approved-model',
    '2026.09-foundation',
    5,
    100
  )
)
update ai_test_context
set second_request_id = admitted.request_id
from admitted;

select lives_ok(
  format(
    $query$
      select public.fail_ai_request(
        %L::uuid,
        %L::uuid,
        'CANCELLED'::public.ai_request_status,
        'CLIENT_CANCELLED'
      )
    $query$,
    (select second_request_id from ai_test_context),
    (select user_id from ai_test_context)
  ),
  'a running AI request can record a real client cancellation'
);

select is(
  (
    select status::text
    from public.ai_requests
    where id = (select second_request_id from ai_test_context)
  ),
  'CANCELLED',
  'cancellation writes the terminal cancelled state'
);

select is(
  (
    select input_redacted ? 'question'
    from public.ai_requests
    where id = (select first_request_id from ai_test_context)
  ),
  false,
  'the audit payload does not require raw question storage'
);

select * from finish();

rollback;
