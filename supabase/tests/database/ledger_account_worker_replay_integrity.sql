begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table worker_integrity_ctx (
  actor_id uuid default gen_random_uuid(),
  member_id uuid default gen_random_uuid(),
  account_id uuid,
  expense_id uuid default gen_random_uuid(),
  journal_id uuid default gen_random_uuid(),
  event_id uuid default gen_random_uuid(),
  job_id uuid default gen_random_uuid(),
  capped_job_id uuid default gen_random_uuid(),
  event_request uuid default gen_random_uuid(),
  job_request uuid default gen_random_uuid(),
  cap_request uuid default gen_random_uuid()
);
insert into worker_integrity_ctx default values;
grant select on worker_integrity_ctx to service_role;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person, 'authenticated', 'authenticated', person::text || '@worker-integrity.putduk.test', '',
  statement_timestamp(), '{}', '{}', statement_timestamp(), statement_timestamp(), '', '', '', ''
from worker_integrity_ctx
cross join lateral unnest(array[actor_id, member_id]) as person;
insert into public.user_roles (user_id, role, granted_by)
select actor_id, 'ADMIN', actor_id from worker_integrity_ctx;

insert into public.ledger_accounts (code, currency, account_class, normal_side, owner_user_id)
select 'USER:' || upper(member_id::text) || ':KRW:LIABILITY', 'KRW', 'LIABILITY', 'CREDIT', member_id
from worker_integrity_ctx;
update worker_integrity_ctx set account_id = account.id
from public.ledger_accounts as account where account.owner_user_id = member_id;
insert into public.ledger_accounts (id, code, currency, account_class, normal_side)
select expense_id, 'TEST:WORKER:' || upper(expense_id::text), 'KRW', 'EXPENSE', 'DEBIT'
from worker_integrity_ctx;
insert into public.ledger_transactions (
  id, category, currency, idempotency_key, reference_type, reference_id,
  member_user_id, request_id, correlation_id, description
)
select journal_id, 'ADMIN_ADJUSTMENT', 'KRW', 'worker-integrity-journal:' || journal_id::text,
  'worker_integrity_probe', member_id, member_id, gen_random_uuid(), gen_random_uuid(), 'Reviewed test journal'
from worker_integrity_ctx;
insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
select journal_id, expense_id, 0, 'DEBIT'::public.ledger_side, 100 from worker_integrity_ctx
union all
select journal_id, account_id, 1, 'CREDIT'::public.ledger_side, 100 from worker_integrity_ctx;
set constraints ledger_entries_balanced_at_commit, ledger_transactions_balanced_at_commit immediate;
set constraints ledger_entries_balanced_at_commit, ledger_transactions_balanced_at_commit deferred;

insert into public.outbox_events (
  id, event_type, schema_version, aggregate_type, aggregate_id, payload,
  correlation_id, request_id, idempotency_key, status
)
select event_id, 'WORKER_REPLAY_PROBE.v1', 1, 'worker_probe', member_id, '{}',
  gen_random_uuid(), gen_random_uuid(), 'worker-integrity-event:' || event_id::text, 'DEAD_LETTER'
from worker_integrity_ctx;
insert into public.system_jobs (id, job_type, idempotency_key, status, attempts, max_attempts)
select job_id, 'WORKER_REPLAY_PROBE', 'worker-integrity-job:' || job_id::text, 'DEAD_LETTER'::public.system_job_status, 12, 12
from worker_integrity_ctx
union all
select capped_job_id, 'WORKER_REPLAY_CAP', 'worker-integrity-cap:' || capped_job_id::text, 'DEAD_LETTER'::public.system_job_status, 100, 100
from worker_integrity_ctx;

set local role service_role;
select throws_ok($$update public.ledger_accounts set code = code || ':CHANGED'
  where id = (select account_id from worker_integrity_ctx)$$,
  '55000', 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE', 'account codes cannot rewrite journal identity');
select throws_ok($$update public.ledger_accounts set currency = 'USDT'
  where id = (select account_id from worker_integrity_ctx)$$,
  '55000', 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE', 'account currency cannot reinterpret posted amounts');
select throws_ok($$update public.ledger_accounts set owner_user_id = (select actor_id from worker_integrity_ctx)
  where id = (select account_id from worker_integrity_ctx)$$,
  '55000', 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE', 'account owner cannot move journal history');
select throws_ok($$update public.ledger_accounts set account_class = 'ASSET', normal_side = 'DEBIT'
  where id = (select account_id from worker_integrity_ctx)$$,
  '55000', 'LEDGER_ACCOUNT_IDENTITY_IS_IMMUTABLE', 'account classification and normal side remain immutable');
select lives_ok($$update public.ledger_accounts set closed_at = clock_timestamp()
  where id = (select account_id from worker_integrity_ctx)$$, 'legitimate account closure remains available');
select throws_ok($$update public.ledger_accounts set closed_at = null
  where id = (select account_id from worker_integrity_ctx)$$,
  '55000', 'LEDGER_ACCOUNT_CLOSURE_IS_IMMUTABLE', 'a closed account cannot be reopened');
select throws_ok($$update public.ledger_accounts set closed_at = closed_at + interval '1 second'
  where id = (select account_id from worker_integrity_ctx)$$,
  '55000', 'LEDGER_ACCOUNT_CLOSURE_IS_IMMUTABLE', 'closure evidence cannot be redated');

select is(public.replay_outbox_event(event_id, actor_id, 'Reviewed event replay', event_request),
  event_id, 'the first replay returns the original event') from worker_integrity_ctx;
select is(public.replay_system_job(job_id, actor_id, 'Reviewed job replay', job_request),
  job_id, 'the first replay returns the original job') from worker_integrity_ctx;
select ok((select status = 'PENDING' and attempts = 12 and max_attempts = 24
  from public.system_jobs where id = (select job_id from worker_integrity_ctx)),
  'job replay preserves history and grants a bounded new attempt budget');
reset role;

-- Represent a later terminal failure. A delayed retry of the earlier replay
-- request must return its receipt without undoing this newer terminal state.
update public.outbox_events set status = 'DEAD_LETTER', attempt_count = 1
where id = (select event_id from worker_integrity_ctx);
update public.system_jobs set status = 'DEAD_LETTER', attempts = 24, max_attempts = 24
where id = (select job_id from worker_integrity_ctx);

set local role service_role;
select is(public.replay_outbox_event(event_id, actor_id, 'Reviewed event replay', event_request),
  event_id, 'a delayed event replay retry returns its original receipt') from worker_integrity_ctx;
select is(public.replay_system_job(job_id, actor_id, 'Reviewed job replay', job_request),
  job_id, 'a delayed job replay retry returns its original receipt') from worker_integrity_ctx;
select ok((select status = 'DEAD_LETTER' and attempt_count = 1
  from public.outbox_events where id = (select event_id from worker_integrity_ctx)),
  'the prior event approval cannot replay a subsequent failure');
select ok((select status = 'DEAD_LETTER' and attempts = 24 and max_attempts = 24
  from public.system_jobs where id = (select job_id from worker_integrity_ctx)),
  'the prior job approval cannot increase a subsequent attempt budget');
select is((select count(*) from public.audit_logs
  where request_id in (select event_request from worker_integrity_ctx union all select job_request from worker_integrity_ctx)),
  2::bigint, 'the two replay approvals each retain exactly one audit receipt');
select throws_ok($$select public.replay_outbox_event(event_id, actor_id, 'Changed replay intent', event_request)
  from worker_integrity_ctx$$, '22023', 'REPLAY_IDEMPOTENCY_KEY_CONFLICT', 'an event replay key cannot change its intent');
select throws_ok($$select public.replay_system_job(capped_job_id, actor_id, 'Reviewed job replay', job_request)
  from worker_integrity_ctx$$, '22023', 'REPLAY_IDEMPOTENCY_KEY_CONFLICT', 'a job replay key cannot change its target');
select throws_ok($$select public.replay_system_job(capped_job_id, actor_id, 'Reviewed capped replay', cap_request)
  from worker_integrity_ctx$$, '55000', 'JOB_REPLAY_BUDGET_EXHAUSTED', 'exhausted absolute budget refuses a false recovery');
select ok((select status = 'DEAD_LETTER' and attempts = 100 and max_attempts = 100
  from public.system_jobs where id = (select capped_job_id from worker_integrity_ctx)),
  'refused replay leaves the exhausted job unchanged');
select is((select count(*) from public.audit_logs where request_id = (select cap_request from worker_integrity_ctx)),
  0::bigint, 'refused replay never records an approval effect');
select is(public.replay_system_job(job_id, actor_id, 'Fresh reviewed job replay', gen_random_uuid()),
  job_id, 'a new approval can replay the later failure') from worker_integrity_ctx;
select ok((select status = 'PENDING' and attempts = 24 and max_attempts = 36
  from public.system_jobs where id = (select job_id from worker_integrity_ctx)),
  'new approval increases only the remaining bounded budget');

select * from finish();
rollback;
