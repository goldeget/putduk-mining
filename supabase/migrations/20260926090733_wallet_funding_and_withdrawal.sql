begin;

create table public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  currency public.currency_code not null,
  created_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  constraint wallet_accounts_id_user_unique unique (id, user_id),
  constraint wallet_accounts_user_currency_unique unique (user_id, currency),
  constraint wallet_accounts_close_order
    check (closed_at is null or closed_at >= created_at)
);

create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_account_id uuid not null,
  user_id uuid not null,
  direction public.ledger_direction not null,
  entry_type public.ledger_entry_type not null,
  amount_atomic bigint not null,
  idempotency_key text not null unique,
  reference_type text not null,
  reference_id uuid,
  reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint wallet_ledger_account_user_fk
    foreign key (wallet_account_id, user_id)
    references public.wallet_accounts (id, user_id) on delete restrict,
  constraint wallet_ledger_amount_positive check (amount_atomic > 0),
  constraint wallet_ledger_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint wallet_ledger_reference_type_not_blank check (btrim(reference_type) <> ''),
  constraint wallet_ledger_admin_reason
    check (entry_type <> 'ADMIN_ADJUSTMENT' or btrim(coalesce(reason, '')) <> '')
);

create table public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  currency public.currency_code not null,
  amount_atomic bigint not null,
  status public.deposit_status not null default 'REQUESTED',
  idempotency_key text not null unique,
  requested_at timestamptz not null default statement_timestamp(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  updated_at timestamptz not null default statement_timestamp(),
  constraint deposit_requests_id_user_unique unique (id, user_id),
  constraint deposit_requests_amount_positive check (amount_atomic > 0),
  constraint deposit_requests_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint deposit_requests_review_pair
    check ((reviewed_by is null) = (reviewed_at is null)),
  constraint deposit_requests_rejection_reason
    check (status <> 'REJECTED' or btrim(coalesce(rejection_reason, '')) <> '')
);

create table public.bank_deposits (
  id uuid primary key default gen_random_uuid(),
  deposit_request_id uuid not null unique,
  user_id uuid not null,
  depositor_name text not null,
  transfer_reference text,
  received_amount_atomic bigint,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint bank_deposits_request_user_fk
    foreign key (deposit_request_id, user_id)
    references public.deposit_requests (id, user_id) on delete restrict,
  constraint bank_deposits_depositor_name_not_blank check (btrim(depositor_name) <> ''),
  constraint bank_deposits_received_amount_positive
    check (received_amount_atomic is null or received_amount_atomic > 0),
  constraint bank_deposits_verification_pair
    check ((verified_by is null) = (verified_at is null))
);

create table public.asset_reference_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency public.currency_code not null,
  quote_currency public.currency_code not null,
  rate numeric(30, 12) not null,
  version integer not null,
  effective_at timestamptz not null,
  expires_at timestamptz,
  approved_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint asset_reference_rates_distinct_pair
    check (base_currency <> quote_currency),
  constraint asset_reference_rates_rate_positive check (rate > 0),
  constraint asset_reference_rates_version_positive check (version > 0),
  constraint asset_reference_rates_time_order
    check (expires_at is null or expires_at > effective_at),
  constraint asset_reference_rates_unique_version
    unique (base_currency, quote_currency, version),
  constraint asset_reference_rates_unique_effective
    unique (base_currency, quote_currency, effective_at)
);

create table public.crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  deposit_request_id uuid not null unique,
  user_id uuid not null,
  network text not null,
  deposit_address text not null,
  transaction_hash text,
  confirmations integer not null default 0,
  received_amount_atomic bigint,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint crypto_deposits_request_user_fk
    foreign key (deposit_request_id, user_id)
    references public.deposit_requests (id, user_id) on delete restrict,
  constraint crypto_deposits_network_not_blank check (btrim(network) <> ''),
  constraint crypto_deposits_address_not_blank check (btrim(deposit_address) <> ''),
  constraint crypto_deposits_confirmations_non_negative check (confirmations >= 0),
  constraint crypto_deposits_received_amount_positive
    check (received_amount_atomic is null or received_amount_atomic > 0),
  constraint crypto_deposits_verification_pair
    check ((verified_by is null) = (verified_at is null))
);

create table public.crypto_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  network text not null,
  transaction_hash text not null,
  direction text not null,
  amount_atomic bigint not null,
  block_height bigint,
  confirmations integer not null default 0,
  observed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint crypto_transactions_network_not_blank check (btrim(network) <> ''),
  constraint crypto_transactions_hash_not_blank check (btrim(transaction_hash) <> ''),
  constraint crypto_transactions_direction check (direction in ('INBOUND', 'OUTBOUND')),
  constraint crypto_transactions_amount_positive check (amount_atomic > 0),
  constraint crypto_transactions_block_height_non_negative
    check (block_height is null or block_height >= 0),
  constraint crypto_transactions_confirmations_non_negative check (confirmations >= 0),
  constraint crypto_transactions_unique_hash unique (network, transaction_hash)
);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_account_id uuid not null,
  user_id uuid not null,
  currency public.currency_code not null,
  amount_atomic bigint not null,
  fee_atomic bigint not null default 0,
  destination_type text not null,
  destination_snapshot jsonb not null,
  status public.withdrawal_status not null default 'REQUESTED',
  idempotency_key text not null unique,
  requested_at timestamptz not null default statement_timestamp(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  updated_at timestamptz not null default statement_timestamp(),
  constraint withdrawal_requests_account_user_fk
    foreign key (wallet_account_id, user_id)
    references public.wallet_accounts (id, user_id) on delete restrict,
  constraint withdrawal_requests_id_user_unique unique (id, user_id),
  constraint withdrawal_requests_amount_positive check (amount_atomic > 0),
  constraint withdrawal_requests_fee_non_negative check (fee_atomic >= 0),
  constraint withdrawal_requests_destination_type_not_blank
    check (btrim(destination_type) <> ''),
  constraint withdrawal_requests_destination_object
    check (jsonb_typeof(destination_snapshot) = 'object'),
  constraint withdrawal_requests_idempotency_key_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint withdrawal_requests_review_pair
    check ((reviewed_by is null) = (reviewed_at is null)),
  constraint withdrawal_requests_rejection_reason
    check (status <> 'REJECTED' or btrim(coalesce(rejection_reason, '')) <> '')
);

create table public.crypto_withdrawals (
  id uuid primary key default gen_random_uuid(),
  withdrawal_request_id uuid not null unique,
  user_id uuid not null,
  network text not null,
  destination_address text not null,
  transaction_hash text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint crypto_withdrawals_request_user_fk
    foreign key (withdrawal_request_id, user_id)
    references public.withdrawal_requests (id, user_id) on delete restrict,
  constraint crypto_withdrawals_network_not_blank check (btrim(network) <> ''),
  constraint crypto_withdrawals_address_not_blank check (btrim(destination_address) <> ''),
  constraint crypto_withdrawals_time_order
    check (completed_at is null or (submitted_at is not null and completed_at >= submitted_at))
);

create index wallet_accounts_user_id_idx on public.wallet_accounts (user_id);
create index wallet_ledger_account_created_idx
  on public.wallet_ledger (wallet_account_id, created_at desc);
create index wallet_ledger_user_created_idx on public.wallet_ledger (user_id, created_at desc);
create index wallet_ledger_reference_idx
  on public.wallet_ledger (reference_type, reference_id)
  where reference_id is not null;
create index deposit_requests_user_requested_idx
  on public.deposit_requests (user_id, requested_at desc);
create index deposit_requests_pending_idx on public.deposit_requests (status, requested_at)
  where status in ('REQUESTED', 'AWAITING_TRANSFER', 'REVIEWING');
create index asset_reference_rates_effective_idx
  on public.asset_reference_rates (base_currency, quote_currency, effective_at desc);
create index crypto_deposits_user_id_idx on public.crypto_deposits (user_id);
create index crypto_transactions_user_observed_idx
  on public.crypto_transactions (user_id, observed_at desc);
create index withdrawal_requests_user_requested_idx
  on public.withdrawal_requests (user_id, requested_at desc);
create index withdrawal_requests_pending_idx
  on public.withdrawal_requests (status, requested_at)
  where status in ('REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING');
create index crypto_withdrawals_user_id_idx on public.crypto_withdrawals (user_id);

create trigger wallet_ledger_prevent_update_delete
before update or delete on public.wallet_ledger
for each row execute function app_private.prevent_row_mutation();
create trigger deposit_requests_set_updated_at
before update on public.deposit_requests
for each row execute function app_private.set_updated_at();
create trigger asset_reference_rates_prevent_update_delete
before update or delete on public.asset_reference_rates
for each row execute function app_private.prevent_row_mutation();
create trigger crypto_deposits_set_updated_at
before update on public.crypto_deposits
for each row execute function app_private.set_updated_at();
create trigger withdrawal_requests_set_updated_at
before update on public.withdrawal_requests
for each row execute function app_private.set_updated_at();
create trigger crypto_withdrawals_set_updated_at
before update on public.crypto_withdrawals
for each row execute function app_private.set_updated_at();

alter table public.wallet_accounts enable row level security;
alter table public.wallet_accounts force row level security;
alter table public.wallet_ledger enable row level security;
alter table public.wallet_ledger force row level security;
alter table public.deposit_requests enable row level security;
alter table public.deposit_requests force row level security;
alter table public.bank_deposits enable row level security;
alter table public.bank_deposits force row level security;
alter table public.asset_reference_rates enable row level security;
alter table public.asset_reference_rates force row level security;
alter table public.crypto_deposits enable row level security;
alter table public.crypto_deposits force row level security;
alter table public.crypto_transactions enable row level security;
alter table public.crypto_transactions force row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.withdrawal_requests force row level security;
alter table public.crypto_withdrawals enable row level security;
alter table public.crypto_withdrawals force row level security;

grant select on
  public.wallet_accounts,
  public.wallet_ledger,
  public.deposit_requests,
  public.bank_deposits,
  public.crypto_deposits,
  public.crypto_transactions,
  public.withdrawal_requests,
  public.crypto_withdrawals
to authenticated;

create policy wallet_accounts_select_own
on public.wallet_accounts for select to authenticated
using ((select auth.uid()) = user_id);
create policy wallet_ledger_select_own
on public.wallet_ledger for select to authenticated
using ((select auth.uid()) = user_id);
create policy deposit_requests_select_own
on public.deposit_requests for select to authenticated
using ((select auth.uid()) = user_id);
create policy bank_deposits_select_own
on public.bank_deposits for select to authenticated
using ((select auth.uid()) = user_id);
create policy crypto_deposits_select_own
on public.crypto_deposits for select to authenticated
using ((select auth.uid()) = user_id);
create policy crypto_transactions_select_own
on public.crypto_transactions for select to authenticated
using ((select auth.uid()) = user_id);
create policy withdrawal_requests_select_own
on public.withdrawal_requests for select to authenticated
using ((select auth.uid()) = user_id);
create policy crypto_withdrawals_select_own
on public.crypto_withdrawals for select to authenticated
using ((select auth.uid()) = user_id);

comment on table public.wallet_accounts is
  'Account identity only. Balance is derived from wallet_ledger; no mutable balance column exists.';
comment on table public.wallet_ledger is
  'Append-only real wallet ledger. Client roles have SELECT only and cannot create entries.';
comment on table public.asset_reference_rates is
  'Operator-approved versioned rates; no external exchange or market-data dependency is assumed.';

commit;
