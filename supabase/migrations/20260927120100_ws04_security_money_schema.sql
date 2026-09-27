begin;

-- ---------------------------------------------------------------------------
-- Rate-limit store (app_private)
-- ---------------------------------------------------------------------------

create table app_private.command_rate_limits (
  scope text not null,
  bucket_key text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (scope, bucket_key),
  constraint command_rate_limits_scope_not_blank check (btrim(scope) <> ''),
  constraint command_rate_limits_bucket_not_blank check (btrim(bucket_key) <> ''),
  constraint command_rate_limits_attempts_non_negative check (attempt_count >= 0)
);

revoke all on table app_private.command_rate_limits from public, anon, authenticated;
grant select, insert, update on table app_private.command_rate_limits to service_role;

create function app_private.assert_not_safe_mode(p_components text[])
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1
    from public.safe_mode_controls as control
    where control.component = any (p_components)
      and control.is_paused
      and control.starts_at <= statement_timestamp()
  ) then
    raise exception using errcode = '55000', message = 'SAFE_MODE_ACTIVE';
  end if;
end;
$$;

revoke all on function app_private.assert_not_safe_mode(text[])
  from public, anon, authenticated;

create function app_private.touch_command_rate_limit(
  p_scope text,
  p_bucket_key text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_lock_seconds integer
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_row app_private.command_rate_limits%rowtype;
begin
  if char_length(btrim(coalesce(p_scope, ''))) < 1
    or char_length(btrim(coalesce(p_bucket_key, ''))) < 1
    or p_max_attempts < 1
    or p_window_seconds < 1
    or p_lock_seconds < 1
  then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_CONTEXT';
  end if;

  insert into app_private.command_rate_limits (
    scope, bucket_key, window_started_at, attempt_count
  ) values (
    p_scope, p_bucket_key, statement_timestamp(), 0
  )
  on conflict (scope, bucket_key) do nothing;

  select * into v_row
  from app_private.command_rate_limits
  where scope = p_scope and bucket_key = p_bucket_key
  for update;

  if v_row.locked_until is not null and v_row.locked_until > statement_timestamp() then
    raise exception using errcode = '55000', message = 'RATE_LIMITED';
  end if;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) < statement_timestamp() then
    update app_private.command_rate_limits
    set
      window_started_at = statement_timestamp(),
      attempt_count = 1,
      locked_until = null,
      updated_at = statement_timestamp()
    where scope = p_scope and bucket_key = p_bucket_key;
    return;
  end if;

  if v_row.attempt_count >= p_max_attempts then
    update app_private.command_rate_limits
    set
      locked_until = statement_timestamp() + make_interval(secs => p_lock_seconds),
      updated_at = statement_timestamp()
    where scope = p_scope and bucket_key = p_bucket_key;
    raise exception using errcode = '55000', message = 'RATE_LIMITED';
  end if;

  update app_private.command_rate_limits
  set
    attempt_count = attempt_count + 1,
    updated_at = statement_timestamp()
  where scope = p_scope and bucket_key = p_bucket_key;
end;
$$;

revoke all on function app_private.touch_command_rate_limit(text, text, integer, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signup phone history (append-only)
-- ---------------------------------------------------------------------------

create table public.signup_phone_history (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  user_id uuid references auth.users (id) on delete set null,
  source text not null,
  request_id uuid,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint signup_phone_history_phone_format
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint signup_phone_history_source
    check (source in ('SIGNUP', 'IDENTITY_UPDATE', 'ADMIN_IMPORT', 'AVAILABILITY_RESERVE'))
);

create unique index signup_phone_history_phone_unique_idx
  on public.signup_phone_history (phone_e164);

create index signup_phone_history_user_recorded_idx
  on public.signup_phone_history (user_id, recorded_at desc);

create trigger signup_phone_history_prevent_update_delete
before update or delete on public.signup_phone_history
for each row execute function app_private.prevent_row_mutation();

alter table public.signup_phone_history enable row level security;
alter table public.signup_phone_history force row level security;

revoke all on table public.signup_phone_history from public, anon, authenticated;
grant select, insert on table public.signup_phone_history to service_role;

-- Backfill current live phones into history (race-safe unique)
insert into public.signup_phone_history (phone_e164, user_id, source)
select profile.phone_e164, profile.user_id, 'SIGNUP'
from public.user_identity_profiles as profile
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- USDT deposit instructions (admin address; not withdrawal destinations)
-- ---------------------------------------------------------------------------

create table public.usdt_deposit_instructions (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  deposit_address text not null,
  is_active boolean not null default true,
  version integer not null,
  set_by uuid not null references auth.users (id) on delete restrict,
  reason text not null,
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  deactivated_at timestamptz,
  constraint usdt_deposit_instructions_network
    check (network in ('TRC20', 'ERC20', 'BEP20')),
  constraint usdt_deposit_instructions_address_not_blank
    check (btrim(deposit_address) <> ''),
  constraint usdt_deposit_instructions_version_positive check (version > 0),
  constraint usdt_deposit_instructions_reason_not_blank check (btrim(reason) <> ''),
  constraint usdt_deposit_instructions_unique_version unique (network, version)
);

create unique index usdt_deposit_instructions_one_active_per_network_idx
  on public.usdt_deposit_instructions (network)
  where is_active;

create trigger usdt_deposit_instructions_prevent_update_delete
before update or delete on public.usdt_deposit_instructions
for each row execute function app_private.prevent_row_mutation();

-- Soft deactivate is done by inserting a replacement active row and marking
-- the prior row via a dedicated command helper (append-only: use new table for
-- deactivation events). Allow controlled status flips through a companion table.
create table public.usdt_deposit_instruction_events (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.usdt_deposit_instructions (id) on delete restrict,
  event_type text not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  reason text not null,
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint usdt_deposit_instruction_events_type
    check (event_type in ('ACTIVATED', 'DEACTIVATED')),
  constraint usdt_deposit_instruction_events_reason_not_blank check (btrim(reason) <> '')
);

create trigger usdt_deposit_instruction_events_prevent_update_delete
before update or delete on public.usdt_deposit_instruction_events
for each row execute function app_private.prevent_row_mutation();

-- Instructions need is_active flips; drop append-only trigger and use event log.
drop trigger usdt_deposit_instructions_prevent_update_delete
  on public.usdt_deposit_instructions;

create trigger usdt_deposit_instructions_set_updated_guard
before delete on public.usdt_deposit_instructions
for each row execute function app_private.prevent_row_mutation();

alter table public.usdt_deposit_instructions enable row level security;
alter table public.usdt_deposit_instructions force row level security;
alter table public.usdt_deposit_instruction_events enable row level security;
alter table public.usdt_deposit_instruction_events force row level security;

revoke all on table public.usdt_deposit_instructions from public, anon, authenticated;
revoke all on table public.usdt_deposit_instruction_events from public, anon, authenticated;
grant select on table public.usdt_deposit_instructions to authenticated, service_role;
grant select, insert, update on table public.usdt_deposit_instructions to service_role;
grant select, insert on table public.usdt_deposit_instruction_events to service_role;

create policy usdt_deposit_instructions_select_active
on public.usdt_deposit_instructions
for select
to authenticated
using (is_active);

create table public.usdt_manual_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  network text not null,
  tx_hash text not null,
  sent_usdt_amount numeric(38, 6) not null,
  deposit_address_snapshot text not null,
  network_snapshot text not null,
  status text not null default 'SUBMITTED',
  credited_krw bigint,
  ledger_transaction_id uuid unique references public.ledger_transactions (id) on delete restrict,
  wallet_ledger_id uuid unique references public.wallet_ledger (id) on delete restrict,
  idempotency_key text not null unique,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint usdt_manual_deposits_network
    check (network in ('TRC20', 'ERC20', 'BEP20')),
  constraint usdt_manual_deposits_tx_hash_not_blank check (btrim(tx_hash) <> ''),
  constraint usdt_manual_deposits_sent_positive check (sent_usdt_amount > 0),
  constraint usdt_manual_deposits_address_snapshot_not_blank
    check (btrim(deposit_address_snapshot) <> ''),
  constraint usdt_manual_deposits_network_snapshot_not_blank
    check (btrim(network_snapshot) <> ''),
  constraint usdt_manual_deposits_status
    check (status in ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
  constraint usdt_manual_deposits_credit_positive
    check (credited_krw is null or credited_krw > 0),
  constraint usdt_manual_deposits_confirm_pair
    check ((confirmed_by is null) = (confirmed_at is null)),
  constraint usdt_manual_deposits_confirmed_shape check (
    (status = 'CONFIRMED' and credited_krw is not null and ledger_transaction_id is not null)
    or (status <> 'CONFIRMED')
  ),
  constraint usdt_manual_deposits_network_tx_unique unique (network, tx_hash)
);

create trigger usdt_manual_deposits_set_updated_at
before update on public.usdt_manual_deposits
for each row execute function app_private.set_updated_at();

alter table public.usdt_manual_deposits enable row level security;
alter table public.usdt_manual_deposits force row level security;

revoke all on table public.usdt_manual_deposits from public, anon, authenticated;
grant select on table public.usdt_manual_deposits to authenticated, service_role;
grant select, insert, update on table public.usdt_manual_deposits to service_role;

create policy usdt_manual_deposits_select_own
on public.usdt_manual_deposits
for select
to authenticated
using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Withdrawal destination history + request hold columns + external sends
-- ---------------------------------------------------------------------------

create table public.withdrawal_destination_history (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.withdrawal_destinations (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  destination_type text not null,
  action text not null,
  display_hint text not null,
  value_fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users (id) on delete set null,
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint withdrawal_destination_history_type
    check (destination_type in ('KRW_BANK', 'USDT_ADDRESS')),
  constraint withdrawal_destination_history_action
    check (action in ('REGISTERED', 'REPLACED', 'REVOKED')),
  constraint withdrawal_destination_history_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create trigger withdrawal_destination_history_prevent_update_delete
before update or delete on public.withdrawal_destination_history
for each row execute function app_private.prevent_row_mutation();

alter table public.withdrawal_destination_history enable row level security;
alter table public.withdrawal_destination_history force row level security;

revoke all on table public.withdrawal_destination_history from public, anon, authenticated;
grant select, insert on table public.withdrawal_destination_history to service_role;

alter table public.withdrawal_requests
  add column hold_ledger_transaction_id uuid
    references public.ledger_transactions (id) on delete restrict,
  add column release_ledger_transaction_id uuid
    references public.ledger_transactions (id) on delete restrict,
  add column finalize_ledger_transaction_id uuid
    references public.ledger_transactions (id) on delete restrict,
  add column hold_posted_at timestamptz,
  add column hold_released_at timestamptz,
  add column ledger_finalized_at timestamptz,
  add column processing_started_at timestamptz;

create table public.withdrawal_external_sends (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null unique
    references public.withdrawal_requests (id) on delete restrict,
  method text not null,
  network text,
  tx_hash text,
  actual_usdt_amount numeric(38, 6),
  conversion_evidence jsonb,
  bank_reference text,
  actual_krw_amount bigint,
  operator_user_id uuid not null references auth.users (id) on delete restrict,
  sent_at timestamptz not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  constraint withdrawal_external_sends_method
    check (method in ('KRW_BANK', 'USDT_ADDRESS')),
  constraint withdrawal_external_sends_usdt_shape check (
    method <> 'USDT_ADDRESS'
    or (
      network is not null
      and btrim(tx_hash) <> ''
      and actual_usdt_amount is not null
      and actual_usdt_amount > 0
      and bank_reference is null
      and actual_krw_amount is null
    )
  ),
  constraint withdrawal_external_sends_krw_shape check (
    method <> 'KRW_BANK'
    or (
      btrim(coalesce(bank_reference, '')) <> ''
      and actual_krw_amount is not null
      and actual_krw_amount > 0
      and network is null
      and tx_hash is null
      and actual_usdt_amount is null
    )
  ),
  constraint withdrawal_external_sends_conversion_object
    check (conversion_evidence is null or jsonb_typeof(conversion_evidence) = 'object')
);

create unique index withdrawal_external_sends_usdt_tx_unique_idx
  on public.withdrawal_external_sends (network, tx_hash)
  where method = 'USDT_ADDRESS';

create trigger withdrawal_external_sends_prevent_update_delete
before update or delete on public.withdrawal_external_sends
for each row execute function app_private.prevent_row_mutation();

alter table public.withdrawal_external_sends enable row level security;
alter table public.withdrawal_external_sends force row level security;

revoke all on table public.withdrawal_external_sends from public, anon, authenticated;
grant select, insert on table public.withdrawal_external_sends to service_role;

-- ---------------------------------------------------------------------------
-- KYC document view audit
-- ---------------------------------------------------------------------------

create table public.kyc_document_view_audit (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.kyc_submissions (id) on delete restrict,
  case_id uuid not null references public.kyc_cases (id) on delete restrict,
  viewer_user_id uuid not null references auth.users (id) on delete restrict,
  request_id uuid not null,
  viewed_at timestamptz not null default statement_timestamp(),
  constraint kyc_document_view_audit_once
    unique (submission_id, viewer_user_id, request_id)
);

create trigger kyc_document_view_audit_prevent_update_delete
before update or delete on public.kyc_document_view_audit
for each row execute function app_private.prevent_row_mutation();

alter table public.kyc_document_view_audit enable row level security;
alter table public.kyc_document_view_audit force row level security;

revoke all on table public.kyc_document_view_audit from public, anon, authenticated;
grant select, insert on table public.kyc_document_view_audit to service_role;

-- ---------------------------------------------------------------------------
-- Admin sessions, step-up grants (separate from public product sessions)
-- ---------------------------------------------------------------------------

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  auth_session_id text not null,
  session_fingerprint text not null,
  created_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  user_agent text,
  constraint admin_sessions_auth_session_not_blank check (btrim(auth_session_id) <> ''),
  constraint admin_sessions_fingerprint_not_blank check (btrim(session_fingerprint) <> ''),
  constraint admin_sessions_lifetime_order
    check (absolute_expires_at > created_at and idle_expires_at > created_at),
  constraint admin_sessions_revoke_reason
    check (revoked_at is null or btrim(coalesce(revoke_reason, '')) <> '')
);

create unique index admin_sessions_active_auth_session_idx
  on public.admin_sessions (auth_session_id)
  where revoked_at is null;

create index admin_sessions_user_active_idx
  on public.admin_sessions (user_id, created_at desc)
  where revoked_at is null;

alter table public.admin_sessions enable row level security;
alter table public.admin_sessions force row level security;

revoke all on table public.admin_sessions from public, anon, authenticated;
grant select, insert, update on table public.admin_sessions to service_role;

create table public.admin_step_up_grants (
  id uuid primary key default gen_random_uuid(),
  admin_session_id uuid not null references public.admin_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  command_family text not null,
  token_hash text not null unique,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consume_request_id uuid,
  constraint admin_step_up_command_family_not_blank check (btrim(command_family) <> ''),
  constraint admin_step_up_token_hash_not_blank check (btrim(token_hash) <> ''),
  constraint admin_step_up_expiry check (expires_at > issued_at),
  constraint admin_step_up_consume_pair
    check ((consumed_at is null) = (consume_request_id is null))
);

alter table public.admin_step_up_grants enable row level security;
alter table public.admin_step_up_grants force row level security;

revoke all on table public.admin_step_up_grants from public, anon, authenticated;
grant select, insert, update on table public.admin_step_up_grants to service_role;

-- ---------------------------------------------------------------------------
-- Available-balance view: include WS-04 hold states
-- ---------------------------------------------------------------------------

create or replace view public.wallet_balance_snapshots
with (security_invoker = true)
as
select
  account.id as wallet_account_id,
  account.user_id,
  account.currency,
  coalesce(ledger.balance_atomic, 0)::text as balance_atomic,
  (
    coalesce(ledger.balance_atomic, 0)
    - coalesce(holds.held_atomic, 0)
  )::text as available_balance_atomic,
  account.created_at,
  account.closed_at
from public.wallet_accounts as account
left join lateral (
  select sum(
    case
      when entry.direction = 'CREDIT' then entry.amount_atomic
      else -entry.amount_atomic
    end
  )::bigint as balance_atomic
  from public.wallet_ledger as entry
  where entry.wallet_account_id = account.id
) as ledger on true
left join lateral (
  select sum(request.amount_atomic + request.fee_atomic)::bigint as held_atomic
  from public.withdrawal_requests as request
  where request.wallet_account_id = account.id
    and request.status in (
      'REQUESTED',
      'HELD',
      'ADMIN_PROCESSING',
      'EXTERNAL_SENT_RECORDED',
      'REVIEWING',
      'APPROVED',
      'PROCESSING'
    )
) as holds on true;

comment on table public.signup_phone_history is
  'Append-only normalized signup phone history for START/re-signup abuse detection. Not SMS ownership proof.';
comment on table public.usdt_deposit_instructions is
  'Admin-configured USDT deposit addresses. Never stored as user withdrawal destinations.';
comment on table public.usdt_manual_deposits is
  'Manual USDT deposit identification requests with immutable address/network snapshots and KRW ledger credit on confirm.';
comment on table public.withdrawal_external_sends is
  'Method-specific external-send evidence. Shared state EXTERNAL_SENT_RECORDED; evidence columns are method-specific.';
comment on table public.admin_sessions is
  'App-owned admin sessions with idle and absolute lifetime. Independent from public product sessions.';

commit;
