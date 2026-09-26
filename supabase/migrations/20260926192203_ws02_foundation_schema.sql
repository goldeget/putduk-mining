begin;

-- Existing enums are extended in their own committed migration boundary. The
-- new values are intentionally first used by the following migration.
alter type public.ledger_entry_type add value if not exists 'TRIAL_REWARD_CONVERSION';
alter type public.ledger_entry_type add value if not exists 'WELCOME_REWARD';
alter type public.ledger_entry_type add value if not exists 'FUNDING_PROMO_REWARD';
alter type public.ledger_entry_type add value if not exists 'REFERRAL_REWARD';
alter type public.system_job_status add value if not exists 'DEAD_LETTER';

create type public.ledger_account_class as enum (
  'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CLEARING'
);
create type public.ledger_side as enum ('DEBIT', 'CREDIT');
create type public.ledger_transaction_category as enum (
  'DEPOSIT',
  'WITHDRAWAL',
  'MINING_REWARD',
  'TRIAL_REWARD_CONVERSION',
  'WELCOME_REWARD',
  'EVENT_REWARD',
  'FUNDING_PROMO_REWARD',
  'REFERRAL_REWARD',
  'UPGRADE_COST',
  'REFUND',
  'REVERSAL',
  'ADMIN_ADJUSTMENT'
);
create type public.outbox_status as enum (
  'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER'
);
create type public.consumer_delivery_status as enum (
  'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER'
);
create type public.trial_conversion_status as enum (
  'PENDING_QUALIFICATION',
  'QUALIFIED',
  'AUTO_HOLD',
  'APPROVED',
  'CONVERTED',
  'REJECTED',
  'REVERSED'
);
create type public.referral_stage as enum ('STAGE_1', 'STAGE_2');
create type public.referral_qualification_status as enum (
  'PENDING', 'QUALIFIED', 'AUTO_HOLD', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED'
);
create type public.promotion_campaign_type as enum (
  'FUNDING_ONLY',
  'ACTIVITY_ONLY',
  'FUNDING_ACTIVITY_HYBRID',
  'PROGRESSION',
  'REFERRAL'
);
create type public.promotion_status as enum (
  'DRAFT', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED'
);
create type public.reward_claim_status as enum (
  'PENDING', 'AUTO_HOLD', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED'
);
create type public.catalog_status as enum ('DRAFT', 'APPROVED', 'PUBLISHED', 'RETIRED');
create type public.product_category as enum (
  'KR_STOCK', 'US_STOCK', 'GOLD', 'SILVER', 'CRYPTO'
);
create type public.product_availability_status as enum (
  'SCHEDULED', 'AVAILABLE', 'PAUSED', 'RETIRED'
);
create type public.kyc_status as enum (
  'PENDING', 'IN_REVIEW', 'APPROVED', 'ON_HOLD', 'REJECTED', 'REQUIRES_RESUBMISSION'
);
create type public.member_lifecycle_stage as enum (
  'VISITOR',
  'SIGNED_UP',
  'TRIAL_STARTED',
  'FIRST_MINING',
  'TRIAL_COMPLETED',
  'FIRST_WELCOME_WITHDRAWAL',
  'WITHDRAWAL_COMPLETED_NO_FUNDING',
  'FIRST_FUNDING',
  'FIRST_REAL_MINING',
  'ACTIVE_7D',
  'ACTIVE_30D',
  'LONG_TERM_ACTIVE'
);
create type public.security_block_scope as enum (
  'ACCOUNT', 'IP_CIDR', 'SESSION', 'DEVICE', 'TRIAL', 'SIGNUP'
);
create type public.feature_flag_status as enum ('DRAFT', 'ACTIVE', 'PAUSED', 'RETIRED');

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  currency public.currency_code not null,
  account_class public.ledger_account_class not null,
  normal_side public.ledger_side not null,
  owner_user_id uuid references auth.users (id) on delete restrict,
  is_controlled_asset boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  constraint ledger_accounts_code_format
    check (code ~ '^[A-Z][A-Z0-9_:.-]{2,127}$'),
  constraint ledger_accounts_close_order
    check (closed_at is null or closed_at >= created_at)
);

-- A member may have only one active account for a currency/class pair. Platform
-- accounts deliberately do not participate because multiple operational control
-- accounts can share the same class without sharing an owner.
create unique index ledger_accounts_member_active_unique_idx
  on public.ledger_accounts (owner_user_id, currency, account_class)
  where owner_user_id is not null and closed_at is null;

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  category public.ledger_transaction_category not null,
  currency public.currency_code not null,
  idempotency_key text not null unique,
  reference_type text not null,
  reference_id uuid,
  member_user_id uuid references auth.users (id) on delete restrict,
  reversal_of_transaction_id uuid references public.ledger_transactions (id) on delete restrict,
  request_id uuid not null,
  correlation_id uuid not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  posted_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint ledger_transactions_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint ledger_transactions_reference_not_blank check (btrim(reference_type) <> ''),
  constraint ledger_transactions_description_not_blank check (btrim(description) <> ''),
  constraint ledger_transactions_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint ledger_transactions_reversal_shape check (
    (category = 'REVERSAL' and reversal_of_transaction_id is not null)
    or (category <> 'REVERSAL' and reversal_of_transaction_id is null)
  )
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions (id) on delete restrict,
  account_id uuid not null references public.ledger_accounts (id) on delete restrict,
  sequence smallint not null,
  side public.ledger_side not null,
  amount_atomic numeric(38, 0) not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint ledger_entries_sequence_non_negative check (sequence >= 0),
  constraint ledger_entries_amount_positive check (amount_atomic > 0),
  constraint ledger_entries_transaction_sequence_unique unique (transaction_id, sequence)
);

create function app_private.enforce_balanced_ledger_transaction()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_transaction_id uuid;
  v_entry_count integer;
  v_debits numeric(38, 0);
  v_credits numeric(38, 0);
  v_currency_count integer;
begin
  v_transaction_id := case
    when tg_op = 'DELETE' then old.transaction_id
    else new.transaction_id
  end;

  select
    count(*)::integer,
    coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0),
    coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0),
    count(distinct account.currency)::integer
  into v_entry_count, v_debits, v_credits, v_currency_count
  from public.ledger_entries as entry
  join public.ledger_accounts as account on account.id = entry.account_id
  where entry.transaction_id = v_transaction_id;

  if v_entry_count < 2 or v_debits <> v_credits or v_currency_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'UNBALANCED_LEDGER_TRANSACTION';
  end if;

  if exists (
    select 1
    from public.ledger_entries as entry
    join public.ledger_accounts as account on account.id = entry.account_id
    join public.ledger_transactions as transaction on transaction.id = entry.transaction_id
    where entry.transaction_id = v_transaction_id
      and account.currency <> transaction.currency
  ) then
    raise exception using errcode = '23514', message = 'LEDGER_CURRENCY_MISMATCH';
  end if;

  return null;
end;
$$;

revoke all on function app_private.enforce_balanced_ledger_transaction()
  from public, anon, authenticated;

create function app_private.enforce_balanced_ledger_header()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_entry_count integer;
  v_debits numeric(38, 0);
  v_credits numeric(38, 0);
  v_currency_count integer;
begin
  select
    count(*)::integer,
    coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0),
    coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0),
    count(distinct account.currency)::integer
  into v_entry_count, v_debits, v_credits, v_currency_count
  from public.ledger_entries as entry
  join public.ledger_accounts as account on account.id = entry.account_id
  where entry.transaction_id = new.id;

  if v_entry_count < 2 or v_debits <> v_credits or v_currency_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'UNBALANCED_LEDGER_TRANSACTION';
  end if;

  if exists (
    select 1
    from public.ledger_entries as entry
    join public.ledger_accounts as account on account.id = entry.account_id
    where entry.transaction_id = new.id
      and account.currency <> new.currency
  ) then
    raise exception using errcode = '23514', message = 'LEDGER_CURRENCY_MISMATCH';
  end if;

  return null;
end;
$$;

revoke all on function app_private.enforce_balanced_ledger_header()
  from public, anon, authenticated;

create constraint trigger ledger_entries_balanced_at_commit
after insert or update or delete on public.ledger_entries
deferrable initially deferred
for each row execute function app_private.enforce_balanced_ledger_transaction();

create constraint trigger ledger_transactions_balanced_at_commit
after insert on public.ledger_transactions
deferrable initially deferred
for each row execute function app_private.enforce_balanced_ledger_header();

create trigger ledger_transactions_prevent_update_delete
before update or delete on public.ledger_transactions
for each row execute function app_private.prevent_row_mutation();
create trigger ledger_entries_prevent_update_delete
before update or delete on public.ledger_entries
for each row execute function app_private.prevent_row_mutation();

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  schema_version integer not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  payload jsonb not null,
  correlation_id uuid not null,
  causation_id uuid,
  request_id uuid not null,
  idempotency_key text not null unique,
  status public.outbox_status not null default 'PENDING',
  available_at timestamptz not null default statement_timestamp(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 12,
  lease_owner text,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint outbox_events_type_versioned
    check (event_type ~ '^[A-Z][A-Z0-9_]*[.]v[1-9][0-9]*$'),
  constraint outbox_events_type_version_matches_schema
    check (event_type ~ ('[.]v' || schema_version::text || '$')),
  constraint outbox_events_schema_version_positive check (schema_version > 0),
  constraint outbox_events_aggregate_not_blank check (btrim(aggregate_type) <> ''),
  constraint outbox_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint outbox_events_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint outbox_events_attempts_range
    check (attempt_count >= 0 and max_attempts between 1 and 100),
  constraint outbox_events_lease_pair
    check ((lease_owner is null) = (lease_expires_at is null))
);

create table public.event_consumer_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.outbox_events (id) on delete cascade,
  consumer_name text not null,
  status public.consumer_delivery_status not null default 'PENDING',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default statement_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint consumer_deliveries_name_not_blank check (btrim(consumer_name) <> ''),
  constraint consumer_deliveries_attempts_non_negative check (attempt_count >= 0),
  constraint consumer_deliveries_lease_pair
    check ((lease_owner is null) = (lease_expires_at is null)),
  constraint consumer_deliveries_unique unique (event_id, consumer_name)
);

create table public.trial_reward_conversions (
  id uuid primary key default gen_random_uuid(),
  trial_account_id uuid not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  status public.trial_conversion_status not null default 'PENDING_QUALIFICATION',
  eligible_amount_atomic bigint not null,
  converted_amount_atomic bigint,
  cap_amount_atomic bigint not null default 5000,
  funding_required boolean not null default false,
  rule_version integer not null,
  risk_model_version text not null,
  decision_reason text,
  idempotency_key text not null unique,
  ledger_transaction_id uuid unique references public.ledger_transactions (id) on delete restrict,
  wallet_ledger_id uuid unique references public.wallet_ledger (id) on delete restrict,
  qualified_at timestamptz,
  next_review_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint trial_reward_conversions_account_user_fk
    foreign key (trial_account_id, user_id)
    references public.trial_accounts (id, user_id) on delete restrict,
  constraint trial_reward_conversions_one_per_trial unique (trial_account_id),
  constraint trial_reward_conversions_amount_non_negative
    check (eligible_amount_atomic >= 0),
  constraint trial_reward_conversions_cap_hard_limit
    check (cap_amount_atomic between 1 and 5000),
  constraint trial_reward_conversions_converted_range
    check (
      converted_amount_atomic is null
      or converted_amount_atomic between 1 and least(eligible_amount_atomic, cap_amount_atomic, 5000)
    ),
  constraint trial_reward_conversions_never_require_funding check (funding_required = false),
  constraint trial_reward_conversions_version_positive check (rule_version > 0),
  constraint trial_reward_conversions_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint trial_reward_conversions_converted_shape check (
    (status = 'CONVERTED' and converted_at is not null and converted_amount_atomic is not null
      and ledger_transaction_id is not null and wallet_ledger_id is not null)
    or (status <> 'CONVERTED')
  )
);

create table public.trial_qualification_snapshots (
  id uuid primary key default gen_random_uuid(),
  conversion_id uuid not null references public.trial_reward_conversions (id) on delete cascade,
  rule_version integer not null,
  risk_model_version text not null,
  kyc_status public.kyc_status not null,
  decision public.trial_conversion_status not null,
  evidence jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint trial_qualification_version_positive check (rule_version > 0),
  constraint trial_qualification_evidence_object check (jsonb_typeof(evidence) = 'object')
);

create table public.referral_program_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  stage_1_reward_atomic bigint not null default 5000,
  stage_2_reward_atomic bigint not null default 5000,
  rule_payload jsonb not null,
  effective_at timestamptz not null,
  retired_at timestamptz,
  approved_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint referral_program_version_positive check (version > 0),
  constraint referral_program_rewards_non_negative
    check (stage_1_reward_atomic >= 0 and stage_2_reward_atomic >= 0),
  constraint referral_program_standard_cap
    check (stage_1_reward_atomic + stage_2_reward_atomic <= 10000),
  constraint referral_program_payload_object check (jsonb_typeof(rule_payload) = 'object'),
  constraint referral_program_window check (retired_at is null or retired_at > effective_at)
);

create table public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users (id) on delete restrict,
  referred_user_id uuid not null unique references auth.users (id) on delete restrict,
  invite_code text not null,
  attributed_at timestamptz not null default statement_timestamp(),
  source_context jsonb not null default '{}'::jsonb,
  constraint referral_attributions_not_self check (referrer_user_id <> referred_user_id),
  constraint referral_attributions_invite_not_blank check (btrim(invite_code) <> ''),
  constraint referral_attributions_context_object check (jsonb_typeof(source_context) = 'object')
);

create table public.referral_qualifications (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referral_attributions (id) on delete restrict,
  stage public.referral_stage not null,
  program_version_id uuid not null references public.referral_program_versions (id) on delete restrict,
  status public.referral_qualification_status not null default 'PENDING',
  rule_version integer not null,
  risk_model_version text not null,
  evidence jsonb not null default '{}'::jsonb,
  decision_reason text,
  next_review_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint referral_qualifications_unique_stage unique (referral_id, stage),
  constraint referral_qualifications_rule_version_positive check (rule_version > 0),
  constraint referral_qualifications_evidence_object check (jsonb_typeof(evidence) = 'object')
);

create table public.referral_reward_claims (
  id uuid primary key default gen_random_uuid(),
  qualification_id uuid not null unique references public.referral_qualifications (id) on delete restrict,
  beneficiary_user_id uuid not null references auth.users (id) on delete restrict,
  amount_atomic bigint not null,
  status public.reward_claim_status not null default 'PENDING',
  idempotency_key text not null unique,
  ledger_transaction_id uuid unique references public.ledger_transactions (id) on delete restrict,
  paid_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint referral_reward_amount_standard_cap check (amount_atomic between 1 and 5000),
  constraint referral_reward_idempotency_not_blank check (btrim(idempotency_key) <> '')
);

create table public.promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  campaign_type public.promotion_campaign_type not null,
  status public.promotion_status not null default 'DRAFT',
  title_ko text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  budget_atomic bigint not null,
  committed_atomic bigint not null default 0,
  paid_atomic bigint not null default 0,
  is_standard_first_funding boolean not null default false,
  is_special_operator_campaign boolean not null default false,
  approved_by uuid references auth.users (id) on delete restrict,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint promotion_campaigns_code_format check (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint promotion_campaigns_title_not_blank check (btrim(title_ko) <> ''),
  constraint promotion_campaigns_window check (ends_at > starts_at),
  constraint promotion_campaigns_budget_non_negative
    check (budget_atomic > 0 and committed_atomic >= 0 and paid_atomic >= 0
      and paid_atomic <= committed_atomic and committed_atomic <= budget_atomic),
  constraint promotion_campaigns_policy_exclusive
    check (not (is_standard_first_funding and is_special_operator_campaign)),
  constraint promotion_campaigns_approval
    check (status = 'DRAFT' or approved_by is not null)
);

create table public.promotion_rule_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns (id) on delete restrict,
  version integer not null,
  reward_kind text not null,
  reward_value bigint not null,
  maximum_bonus_atomic bigint not null,
  minimum_funding_atomic bigint,
  per_user_cap_atomic bigint not null,
  stacking_priority integer not null default 100,
  exclusive_group text,
  rule_payload jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint promotion_rule_versions_unique unique (campaign_id, version),
  constraint promotion_rule_versions_version_positive check (version > 0),
  constraint promotion_rule_versions_kind
    check (reward_kind in ('FIXED', 'PERCENT_BPS', 'TIERED', 'PROGRESSIVE')),
  constraint promotion_rule_versions_values_positive
    check (reward_value > 0 and maximum_bonus_atomic > 0 and per_user_cap_atomic > 0),
  constraint promotion_rule_versions_minimum_positive
    check (minimum_funding_atomic is null or minimum_funding_atomic > 0),
  constraint promotion_rule_versions_payload_object check (jsonb_typeof(rule_payload) = 'object')
);

create function app_private.enforce_first_funding_promotion_cap()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_campaign public.promotion_campaigns%rowtype;
begin
  select campaign.* into v_campaign
  from public.promotion_campaigns as campaign
  where campaign.id = new.campaign_id;

  if v_campaign.is_standard_first_funding
    and (new.maximum_bonus_atomic > 10000 or new.per_user_cap_atomic > 10000)
  then
    raise exception using
      errcode = '23514',
      message = 'STANDARD_FIRST_FUNDING_REWARD_CAP_EXCEEDED';
  end if;

  return new;
end;
$$;

revoke all on function app_private.enforce_first_funding_promotion_cap()
  from public, anon, authenticated;

create trigger promotion_rule_versions_enforce_first_funding_cap
before insert on public.promotion_rule_versions
for each row execute function app_private.enforce_first_funding_promotion_cap();

create table public.promotion_reward_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns (id) on delete restrict,
  rule_version_id uuid not null references public.promotion_rule_versions (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  source_event_id uuid not null references public.outbox_events (id) on delete restrict,
  amount_atomic bigint not null,
  status public.reward_claim_status not null default 'PENDING',
  idempotency_key text not null unique,
  qualification_snapshot jsonb not null,
  ledger_transaction_id uuid unique references public.ledger_transactions (id) on delete restrict,
  paid_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint promotion_reward_claims_unique_event unique (campaign_id, user_id, source_event_id),
  constraint promotion_reward_claims_amount_positive check (amount_atomic > 0),
  constraint promotion_reward_claims_snapshot_object
    check (jsonb_typeof(qualification_snapshot) = 'object')
);

create table public.product_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  status public.catalog_status not null default 'DRAFT',
  snapshot_date date not null,
  methodology text not null,
  source_references jsonb not null,
  content_digest text not null unique,
  proposed_by text not null default 'AI_ASSISTED',
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint product_catalog_versions_positive check (version > 0),
  constraint product_catalog_methodology_not_blank check (btrim(methodology) <> ''),
  constraint product_catalog_sources_array check (jsonb_typeof(source_references) = 'array'),
  constraint product_catalog_digest_format check (content_digest ~ '^[a-f0-9]{64}$'),
  constraint product_catalog_approval_pair check ((approved_by is null) = (approved_at is null)),
  constraint product_catalog_publish_shape check (status <> 'PUBLISHED' or published_at is not null)
);

create function app_private.enforce_catalog_version_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'CATALOG_VERSION_DELETE_FORBIDDEN';
  end if;

  if old.version is distinct from new.version
    or old.snapshot_date is distinct from new.snapshot_date
    or old.methodology is distinct from new.methodology
    or old.source_references is distinct from new.source_references
    or old.content_digest is distinct from new.content_digest
    or old.proposed_by is distinct from new.proposed_by
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'CATALOG_VERSION_CONTENT_IMMUTABLE';
  end if;

  if old.status <> new.status and not (
    (old.status = 'DRAFT' and new.status in ('APPROVED', 'RETIRED'))
    or (old.status = 'APPROVED' and new.status in ('PUBLISHED', 'RETIRED'))
    or (old.status = 'PUBLISHED' and new.status = 'RETIRED')
  ) then
    raise exception using errcode = '55000', message = 'INVALID_CATALOG_STATUS_TRANSITION';
  end if;

  if new.status in ('APPROVED', 'PUBLISHED')
    and (new.approved_by is null or new.approved_at is null)
  then
    raise exception using errcode = '55000', message = 'CATALOG_APPROVAL_REQUIRED';
  end if;

  if old.status <> 'DRAFT'
    and (
      old.approved_by is distinct from new.approved_by
      or old.approved_at is distinct from new.approved_at
    )
  then
    raise exception using errcode = '55000', message = 'CATALOG_APPROVAL_IMMUTABLE';
  end if;

  if old.status = 'PUBLISHED'
    and old.published_at is distinct from new.published_at
  then
    raise exception using errcode = '55000', message = 'CATALOG_PUBLICATION_IMMUTABLE';
  end if;

  return new;
end;
$$;

revoke all on function app_private.enforce_catalog_version_transition()
  from public, anon, authenticated;

create trigger product_catalog_versions_validate_transition
before update or delete on public.product_catalog_versions
for each row execute function app_private.enforce_catalog_version_transition();

create table public.mining_products (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.product_catalog_versions (id) on delete restrict,
  world_id uuid not null references public.asset_worlds (id) on delete restrict,
  code text not null,
  slug text not null,
  category public.product_category not null,
  name_ko text not null,
  name_en text not null,
  name_ja text,
  description_ko text not null,
  display_order integer not null,
  is_featured boolean not null default false,
  trial_available boolean not null default false,
  display_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint mining_products_code_format check (code ~ '^[A-Z0-9][A-Z0-9_.-]{1,31}$'),
  constraint mining_products_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint mining_products_names_not_blank
    check (btrim(name_ko) <> '' and btrim(name_en) <> '' and btrim(description_ko) <> ''),
  constraint mining_products_order_positive check (display_order > 0),
  constraint mining_products_profile_object check (jsonb_typeof(display_profile) = 'object'),
  constraint mining_products_unique_code unique (catalog_version_id, code),
  constraint mining_products_unique_slug unique (catalog_version_id, slug),
  constraint mining_products_unique_order unique (catalog_version_id, display_order)
);

create table public.product_rule_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.mining_products (id) on delete restrict,
  version integer not null,
  effective_at timestamptz not null,
  retired_at timestamptz,
  rule_payload jsonb not null,
  approved_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint product_rule_versions_positive check (version > 0),
  constraint product_rule_versions_window check (retired_at is null or retired_at > effective_at),
  constraint product_rule_versions_payload_object check (jsonb_typeof(rule_payload) = 'object'),
  constraint product_rule_versions_unique unique (product_id, version)
);

create table public.product_visuals (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.mining_products (id) on delete cascade,
  theme text not null,
  asset_path text not null,
  alt_ko text not null,
  width integer,
  height integer,
  created_at timestamptz not null default statement_timestamp(),
  constraint product_visuals_theme check (theme in ('LIGHT', 'DARK', 'SYSTEM')),
  constraint product_visuals_relative_path check (asset_path ~ '^/' and asset_path !~ '^//'),
  constraint product_visuals_alt_not_blank check (btrim(alt_ko) <> ''),
  constraint product_visuals_dimensions check (
    (width is null and height is null) or (width > 0 and height > 0)
  ),
  constraint product_visuals_unique unique (product_id, theme, asset_path)
);

create table public.product_availability (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.mining_products (id) on delete cascade,
  status public.product_availability_status not null,
  available_from timestamptz not null,
  available_to timestamptz,
  segment_key text,
  created_at timestamptz not null default statement_timestamp(),
  constraint product_availability_window check (available_to is null or available_to > available_from),
  constraint product_availability_unique unique (product_id, available_from)
);

create function app_private.enforce_draft_product_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_new_status public.catalog_status;
  v_old_status public.catalog_status;
begin
  if tg_op <> 'DELETE' then
    select catalog.status into v_new_status
    from public.product_catalog_versions as catalog
    where catalog.id = new.catalog_version_id;
  end if;
  if tg_op <> 'INSERT' then
    select catalog.status into v_old_status
    from public.product_catalog_versions as catalog
    where catalog.id = old.catalog_version_id;
  end if;

  if coalesce(v_new_status, 'DRAFT') <> 'DRAFT'
    or coalesce(v_old_status, 'DRAFT') <> 'DRAFT'
  then
    raise exception using errcode = '55000', message = 'PUBLISHED_CATALOG_PRODUCT_MUTATION_FORBIDDEN';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function app_private.enforce_draft_product_child_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_new_status public.catalog_status;
  v_old_status public.catalog_status;
begin
  if tg_op <> 'DELETE' then
    select catalog.status into v_new_status
    from public.mining_products as product
    join public.product_catalog_versions as catalog on catalog.id = product.catalog_version_id
    where product.id = new.product_id;
  end if;
  if tg_op <> 'INSERT' then
    select catalog.status into v_old_status
    from public.mining_products as product
    join public.product_catalog_versions as catalog on catalog.id = product.catalog_version_id
    where product.id = old.product_id;
  end if;

  if coalesce(v_new_status, 'DRAFT') <> 'DRAFT'
    or coalesce(v_old_status, 'DRAFT') <> 'DRAFT'
  then
    raise exception using errcode = '55000', message = 'PUBLISHED_CATALOG_CHILD_MUTATION_FORBIDDEN';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_draft_product_mutation()
  from public, anon, authenticated;
revoke all on function app_private.enforce_draft_product_child_mutation()
  from public, anon, authenticated;

create trigger mining_products_require_draft_catalog
before insert or update or delete on public.mining_products
for each row execute function app_private.enforce_draft_product_mutation();
create trigger product_rule_versions_require_draft_catalog
before insert or update or delete on public.product_rule_versions
for each row execute function app_private.enforce_draft_product_child_mutation();
create trigger product_visuals_require_draft_catalog
before insert or update or delete on public.product_visuals
for each row execute function app_private.enforce_draft_product_child_mutation();
create trigger product_availability_require_draft_catalog
before insert or update or delete on public.product_availability
for each row execute function app_private.enforce_draft_product_child_mutation();

create table public.kyc_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  status public.kyc_status not null default 'PENDING',
  risk_level text not null default 'UNASSESSED',
  opened_at timestamptz not null default statement_timestamp(),
  decided_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  decision_reason text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint kyc_cases_risk_level
    check (risk_level in ('UNASSESSED', 'LOW', 'MEDIUM', 'HIGH')),
  constraint kyc_cases_decision_reason
    check (status not in ('REJECTED', 'ON_HOLD') or btrim(coalesce(decision_reason, '')) <> '')
);
create unique index kyc_cases_one_open_per_user_idx on public.kyc_cases (user_id)
  where status in ('PENDING', 'IN_REVIEW', 'ON_HOLD', 'REQUIRES_RESUBMISSION');

create table public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.kyc_cases (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  document_kind text not null,
  protected_storage_path text not null,
  content_sha256 text not null,
  submitted_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint kyc_submissions_kind_not_blank check (btrim(document_kind) <> ''),
  constraint kyc_submissions_path_not_url
    check (protected_storage_path !~* '^https?://' and btrim(protected_storage_path) <> ''),
  constraint kyc_submissions_hash_format check (content_sha256 ~ '^[A-Fa-f0-9]{64}$')
);

create table public.kyc_status_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.kyc_cases (id) on delete restrict,
  from_status public.kyc_status,
  to_status public.kyc_status not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  reason text not null,
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint kyc_status_history_reason_not_blank check (btrim(reason) <> '')
);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  trusted_client_ip inet,
  ip_source text not null,
  user_agent text,
  device_context jsonb not null default '{}'::jsonb,
  risk_score integer,
  request_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint security_events_type_not_blank check (btrim(event_type) <> ''),
  constraint security_events_ip_source
    check (ip_source in ('DIRECT_TRUSTED', 'CLOUDFLARE_VERIFIED', 'NONE')),
  constraint security_events_context_object check (jsonb_typeof(device_context) = 'object'),
  constraint security_events_risk_range check (risk_score is null or risk_score between 0 and 1000)
);

create table public.risk_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  flag_code text not null,
  severity text not null,
  source_type text not null,
  source_id uuid,
  evidence jsonb not null,
  model_version text not null,
  resolved_at timestamptz,
  resolution_reason text,
  created_at timestamptz not null default statement_timestamp(),
  constraint risk_flags_code_format check (flag_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint risk_flags_severity check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  constraint risk_flags_evidence_object check (jsonb_typeof(evidence) = 'object'),
  constraint risk_flags_resolution_reason
    check (resolved_at is null or btrim(coalesce(resolution_reason, '')) <> '')
);

create table public.block_rules (
  id uuid primary key default gen_random_uuid(),
  scope public.security_block_scope not null,
  user_id uuid references auth.users (id) on delete cascade,
  ip_range cidr,
  session_id uuid,
  device_hash text,
  reason text not null,
  source text not null,
  starts_at timestamptz not null default statement_timestamp(),
  ends_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint block_rules_reason_not_blank check (btrim(reason) <> ''),
  constraint block_rules_source_not_blank check (btrim(source) <> ''),
  constraint block_rules_window check (ends_at is null or ends_at > starts_at),
  constraint block_rules_target_present check (
    user_id is not null or ip_range is not null or session_id is not null or device_hash is not null
  )
);

create table public.block_history (
  id uuid primary key default gen_random_uuid(),
  block_rule_id uuid not null references public.block_rules (id) on delete restrict,
  action text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  reason text not null,
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint block_history_action check (action in ('CREATED', 'EXPIRED', 'REVOKED')),
  constraint block_history_reason_not_blank check (btrim(reason) <> '')
);

create table public.member_lifecycle_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stage public.member_lifecycle_stage not null default 'SIGNED_UP',
  stage_reached_at timestamptz not null default statement_timestamp(),
  first_funding_at timestamptz,
  welcome_withdrawal_completed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

create table public.member_timeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  source_type text not null,
  source_id uuid,
  summary_code text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint member_timeline_event_type_not_blank check (btrim(event_type) <> ''),
  constraint member_timeline_summary_not_blank check (btrim(summary_code) <> ''),
  constraint member_timeline_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.withdrawal_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  destination_type text not null,
  encrypted_value bytea not null,
  value_fingerprint text not null,
  display_hint text not null,
  verification_status text not null default 'PENDING',
  verified_at timestamptz,
  protection_until timestamptz not null,
  replaced_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint withdrawal_destinations_type check (destination_type in ('KRW_BANK', 'USDT_ADDRESS')),
  constraint withdrawal_destinations_fingerprint_not_blank check (btrim(value_fingerprint) <> ''),
  constraint withdrawal_destinations_hint_not_blank check (btrim(display_hint) <> ''),
  constraint withdrawal_destinations_verification
    check (verification_status in ('PENDING', 'VERIFIED', 'REJECTED', 'REVOKED')),
  constraint withdrawal_destinations_verification_pair
    check ((verification_status = 'VERIFIED') = (verified_at is not null)),
  constraint withdrawal_destinations_unique_active unique nulls not distinct (
    user_id, destination_type, value_fingerprint, replaced_at
  )
);

create table public.transaction_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_type text not null,
  source_type text not null,
  source_id uuid not null,
  amount_atomic numeric(38, 0) not null,
  currency public.currency_code not null,
  status text not null,
  requested_at timestamptz not null,
  completed_at timestamptz,
  ledger_transaction_id uuid references public.ledger_transactions (id) on delete restrict,
  status_timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint transaction_receipts_number_format check (receipt_number ~ '^PDK-[A-Z0-9-]{10,64}$'),
  constraint transaction_receipts_source_not_blank check (btrim(source_type) <> ''),
  constraint transaction_receipts_source_unique unique (source_type, source_id),
  constraint transaction_receipts_amount_positive check (amount_atomic > 0),
  constraint transaction_receipts_timeline_array check (jsonb_typeof(status_timeline) = 'array'),
  constraint transaction_receipts_time_order check (completed_at is null or completed_at >= requested_at)
);

create table public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  scope text not null,
  status text not null default 'RUNNING',
  cursor_value text,
  checked_count bigint not null default 0,
  mismatch_count bigint not null default 0,
  totals jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint reconciliation_runs_scope_not_blank check (btrim(scope) <> ''),
  constraint reconciliation_runs_status check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  constraint reconciliation_runs_counts_non_negative check (checked_count >= 0 and mismatch_count >= 0),
  constraint reconciliation_runs_totals_object check (jsonb_typeof(totals) = 'object')
);

create table public.reconciliation_mismatches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.reconciliation_runs (id) on delete restrict,
  mismatch_type text not null,
  subject_type text not null,
  subject_id text not null,
  expected_value jsonb,
  actual_value jsonb,
  status text not null default 'OPEN',
  resolution_reason text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint reconciliation_mismatch_type_not_blank check (btrim(mismatch_type) <> ''),
  constraint reconciliation_mismatch_status check (status in ('OPEN', 'INVESTIGATING', 'RESOLVED', 'ACCEPTED')),
  constraint reconciliation_mismatch_resolution_pair
    check ((resolved_by is null) = (resolved_at is null))
);

create table public.safe_mode_controls (
  id uuid primary key default gen_random_uuid(),
  component text not null unique,
  is_paused boolean not null default false,
  reason text not null,
  starts_at timestamptz not null default statement_timestamp(),
  review_at timestamptz,
  changed_by uuid not null references auth.users (id) on delete restrict,
  request_id uuid not null,
  updated_at timestamptz not null default statement_timestamp(),
  constraint safe_mode_component check (
    component in ('GLOBAL', 'SIGNUP', 'TRIAL', 'NEW_MINING', 'SETTLEMENT', 'DEPOSIT', 'WITHDRAWAL',
      'REFERRAL_PAYOUT', 'EVENT_PAYOUT', 'NOTIFICATION', 'AI')
  ),
  constraint safe_mode_reason_not_blank check (btrim(reason) <> ''),
  constraint safe_mode_review_order check (review_at is null or review_at > starts_at)
);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version integer not null,
  status public.feature_flag_status not null default 'DRAFT',
  default_enabled boolean not null default false,
  rollout_bps integer not null default 0,
  targeting jsonb not null default '{}'::jsonb,
  owner text not null,
  expires_at timestamptz,
  approved_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint feature_flags_key_format check (key ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  constraint feature_flags_version_positive check (version > 0),
  constraint feature_flags_rollout_range check (rollout_bps between 0 and 10000),
  constraint feature_flags_targeting_object check (jsonb_typeof(targeting) = 'object'),
  constraint feature_flags_owner_not_blank check (btrim(owner) <> ''),
  constraint feature_flags_unique_version unique (key, version)
);

create table public.experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  experiment_key text not null,
  experiment_version integer not null,
  variant_key text not null,
  assigned_at timestamptz not null default statement_timestamp(),
  constraint experiment_assignments_keys_not_blank
    check (btrim(experiment_key) <> '' and btrim(variant_key) <> ''),
  constraint experiment_assignments_version_positive check (experiment_version > 0),
  constraint experiment_assignments_unique unique (user_id, experiment_key, experiment_version)
);

create table public.event_reward_claims (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  event_rule_id uuid not null references public.event_rules (id) on delete restrict,
  event_reward_id uuid not null references public.event_rewards (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  status public.reward_claim_status not null default 'PENDING',
  amount_atomic bigint not null,
  qualification_snapshot jsonb not null,
  idempotency_key text not null unique,
  ledger_transaction_id uuid unique references public.ledger_transactions (id) on delete restrict,
  paid_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint event_reward_claims_unique unique (event_id, user_id, event_reward_id),
  constraint event_reward_claims_amount_positive check (amount_atomic > 0),
  constraint event_reward_claims_snapshot_object check (jsonb_typeof(qualification_snapshot) = 'object')
);

alter table public.system_jobs
  add column priority smallint not null default 100,
  add column max_attempts integer not null default 12,
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column correlation_id uuid,
  add column payload_version integer not null default 1,
  add column dead_lettered_at timestamptz,
  add constraint system_jobs_priority_range check (priority between 0 and 1000),
  add constraint system_jobs_max_attempts_range check (max_attempts between 1 and 100),
  add constraint system_jobs_lease_pair check ((lease_owner is null) = (lease_expires_at is null)),
  add constraint system_jobs_payload_version_positive check (payload_version > 0);

create table public.system_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.system_jobs (id) on delete cascade,
  attempt_number integer not null,
  worker_id text not null,
  status text not null,
  error_code text,
  error_class text,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint system_job_attempts_number_positive check (attempt_number > 0),
  constraint system_job_attempts_worker_not_blank check (btrim(worker_id) <> ''),
  constraint system_job_attempts_status check (status in ('RUNNING', 'SUCCEEDED', 'RETRYABLE_FAILED', 'PERMANENT_FAILED')),
  constraint system_job_attempts_time_order check (completed_at is null or completed_at >= started_at),
  constraint system_job_attempts_unique unique (job_id, attempt_number)
);

alter table public.notifications
  add column source_event_id uuid references public.outbox_events (id) on delete restrict,
  add column deduplication_key text,
  add column priority smallint not null default 100,
  add column scheduled_at timestamptz not null default statement_timestamp(),
  add constraint notifications_deduplication_unique unique (user_id, deduplication_key),
  add constraint notifications_priority_range check (priority between 0 and 1000);

alter table public.notification_preferences
  add column daily_marketing_cap smallint not null default 2,
  add column event_cooldown_minutes integer not null default 360,
  add column digest_mode text not null default 'OFF',
  add constraint notification_preferences_daily_cap_range
    check (daily_marketing_cap between 0 and 10),
  add constraint notification_preferences_cooldown_range
    check (event_cooldown_minutes between 0 and 10080),
  add constraint notification_preferences_digest_mode
    check (digest_mode in ('OFF', 'DAILY', 'WEEKLY'));

create index ledger_accounts_owner_idx on public.ledger_accounts (owner_user_id, currency)
  where owner_user_id is not null;
create index ledger_transactions_member_posted_idx
  on public.ledger_transactions (member_user_id, posted_at desc)
  where member_user_id is not null;
create index ledger_transactions_reference_idx
  on public.ledger_transactions (reference_type, reference_id)
  where reference_id is not null;
create index ledger_entries_account_created_idx
  on public.ledger_entries (account_id, created_at, id);
create index outbox_events_due_idx on public.outbox_events (available_at, created_at)
  where status in ('PENDING', 'FAILED');
create index outbox_events_aggregate_idx
  on public.outbox_events (aggregate_type, aggregate_id, occurred_at desc);
create index consumer_deliveries_due_idx
  on public.event_consumer_deliveries (next_attempt_at, created_at)
  where status in ('PENDING', 'FAILED');
create index trial_reward_conversions_user_idx
  on public.trial_reward_conversions (user_id, created_at desc);
create index referral_attributions_referrer_idx
  on public.referral_attributions (referrer_user_id, attributed_at desc);
create index referral_qualifications_status_idx
  on public.referral_qualifications (status, next_review_at, created_at)
  where status in ('PENDING', 'AUTO_HOLD', 'QUALIFIED', 'APPROVED');
create index promotion_campaigns_active_idx
  on public.promotion_campaigns (status, starts_at, ends_at);
create index promotion_reward_claims_user_idx
  on public.promotion_reward_claims (user_id, created_at desc);
create index mining_products_catalog_category_idx
  on public.mining_products (catalog_version_id, category, display_order);
create index product_availability_active_idx
  on public.product_availability (status, available_from, available_to);
create index kyc_cases_user_created_idx on public.kyc_cases (user_id, created_at desc);
create index kyc_submissions_case_idx on public.kyc_submissions (case_id, submitted_at desc);
create index security_events_user_occurred_idx
  on public.security_events (user_id, occurred_at desc);
create index security_events_ip_occurred_idx
  on public.security_events (trusted_client_ip, occurred_at desc)
  where trusted_client_ip is not null;
create index risk_flags_user_open_idx on public.risk_flags (user_id, created_at desc)
  where resolved_at is null;
create index block_rules_user_active_idx on public.block_rules (user_id, starts_at)
  where user_id is not null and ends_at is null;
create index member_timeline_user_occurred_idx
  on public.member_timeline_events (user_id, occurred_at desc);
create index transaction_receipts_user_requested_idx
  on public.transaction_receipts (user_id, requested_at desc);
create index reconciliation_mismatches_open_idx
  on public.reconciliation_mismatches (status, created_at)
  where status in ('OPEN', 'INVESTIGATING');
create index system_jobs_lease_recovery_idx
  on public.system_jobs (lease_expires_at)
  where lease_expires_at is not null;

create trigger outbox_events_set_updated_at
before update on public.outbox_events
for each row execute function app_private.set_updated_at();
create trigger event_consumer_deliveries_set_updated_at
before update on public.event_consumer_deliveries
for each row execute function app_private.set_updated_at();
create trigger trial_reward_conversions_set_updated_at
before update on public.trial_reward_conversions
for each row execute function app_private.set_updated_at();
create trigger trial_qualification_snapshots_prevent_update_delete
before update or delete on public.trial_qualification_snapshots
for each row execute function app_private.prevent_row_mutation();
create trigger referral_program_versions_prevent_update_delete
before update or delete on public.referral_program_versions
for each row execute function app_private.prevent_row_mutation();
create trigger referral_qualifications_set_updated_at
before update on public.referral_qualifications
for each row execute function app_private.set_updated_at();
create trigger referral_reward_claims_set_updated_at
before update on public.referral_reward_claims
for each row execute function app_private.set_updated_at();
create trigger promotion_campaigns_set_updated_at
before update on public.promotion_campaigns
for each row execute function app_private.set_updated_at();
create trigger promotion_rule_versions_prevent_update_delete
before update or delete on public.promotion_rule_versions
for each row execute function app_private.prevent_row_mutation();
create trigger promotion_reward_claims_set_updated_at
before update on public.promotion_reward_claims
for each row execute function app_private.set_updated_at();
create trigger product_rule_versions_prevent_update_delete
before update or delete on public.product_rule_versions
for each row execute function app_private.prevent_row_mutation();
create trigger kyc_cases_set_updated_at
before update on public.kyc_cases
for each row execute function app_private.set_updated_at();
create trigger kyc_status_history_prevent_update_delete
before update or delete on public.kyc_status_history
for each row execute function app_private.prevent_row_mutation();
create trigger security_events_prevent_update_delete
before update or delete on public.security_events
for each row execute function app_private.prevent_row_mutation();
create trigger block_history_prevent_update_delete
before update or delete on public.block_history
for each row execute function app_private.prevent_row_mutation();
create trigger member_lifecycle_states_set_updated_at
before update on public.member_lifecycle_states
for each row execute function app_private.set_updated_at();
create trigger member_timeline_events_prevent_update_delete
before update or delete on public.member_timeline_events
for each row execute function app_private.prevent_row_mutation();
create trigger withdrawal_destinations_set_updated_at
before update on public.withdrawal_destinations
for each row execute function app_private.set_updated_at();
create trigger safe_mode_controls_set_updated_at
before update on public.safe_mode_controls
for each row execute function app_private.set_updated_at();
create trigger feature_flags_prevent_update_delete
before update or delete on public.feature_flags
for each row execute function app_private.prevent_row_mutation();
create trigger event_reward_claims_set_updated_at
before update on public.event_reward_claims
for each row execute function app_private.set_updated_at();

-- Deny-by-default RLS for every new public table.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'ledger_accounts', 'ledger_transactions', 'ledger_entries',
    'outbox_events', 'event_consumer_deliveries',
    'trial_reward_conversions', 'trial_qualification_snapshots',
    'referral_program_versions', 'referral_attributions', 'referral_qualifications',
    'referral_reward_claims', 'promotion_campaigns', 'promotion_rule_versions',
    'promotion_reward_claims', 'product_catalog_versions', 'mining_products',
    'product_rule_versions', 'product_visuals', 'product_availability',
    'kyc_cases', 'kyc_submissions', 'kyc_status_history', 'security_events',
    'risk_flags', 'block_rules', 'block_history', 'member_lifecycle_states',
    'member_timeline_events', 'withdrawal_destinations', 'transaction_receipts',
    'reconciliation_runs', 'reconciliation_mismatches', 'safe_mode_controls',
    'feature_flags', 'experiment_assignments', 'event_reward_claims',
    'system_job_attempts'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
  end loop;
end;
$$;

grant select on public.trial_reward_conversions to authenticated;
create policy trial_reward_conversions_select_own
on public.trial_reward_conversions for select to authenticated
using ((select auth.uid()) = user_id);

grant select on public.referral_attributions, public.referral_qualifications,
  public.referral_reward_claims to authenticated;
create policy referral_attributions_select_participant
on public.referral_attributions for select to authenticated
using ((select auth.uid()) in (referrer_user_id, referred_user_id));
create policy referral_qualifications_select_referrer
on public.referral_qualifications for select to authenticated
using (
  exists (
    select 1 from public.referral_attributions as attribution
    where attribution.id = referral_qualifications.referral_id
      and attribution.referrer_user_id = (select auth.uid())
  )
);
create policy referral_reward_claims_select_own
on public.referral_reward_claims for select to authenticated
using ((select auth.uid()) = beneficiary_user_id);

grant select on public.promotion_campaigns, public.promotion_rule_versions to authenticated;
create policy promotion_campaigns_read_approved
on public.promotion_campaigns for select to authenticated
using (status in ('APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED'));
create policy promotion_rule_versions_read_visible_campaign
on public.promotion_rule_versions for select to authenticated
using (
  exists (
    select 1 from public.promotion_campaigns as campaign
    where campaign.id = promotion_rule_versions.campaign_id
      and campaign.status in ('APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED')
  )
);

grant select on public.product_catalog_versions, public.mining_products,
  public.product_visuals, public.product_availability to anon, authenticated;
create policy product_catalog_versions_read_published
on public.product_catalog_versions for select to anon, authenticated
using (status = 'PUBLISHED' and published_at <= statement_timestamp());
create policy mining_products_read_published_catalog
on public.mining_products for select to anon, authenticated
using (
  exists (
    select 1 from public.product_catalog_versions as catalog
    where catalog.id = mining_products.catalog_version_id
      and catalog.status = 'PUBLISHED'
      and catalog.published_at <= statement_timestamp()
  )
);
create policy product_visuals_read_published_product
on public.product_visuals for select to anon, authenticated
using (
  exists (
    select 1
    from public.mining_products as product
    join public.product_catalog_versions as catalog on catalog.id = product.catalog_version_id
    where product.id = product_visuals.product_id
      and catalog.status = 'PUBLISHED'
      and catalog.published_at <= statement_timestamp()
  )
);
create policy product_availability_read_published_product
on public.product_availability for select to anon, authenticated
using (
  exists (
    select 1
    from public.mining_products as product
    join public.product_catalog_versions as catalog on catalog.id = product.catalog_version_id
    where product.id = product_availability.product_id
      and catalog.status = 'PUBLISHED'
      and catalog.published_at <= statement_timestamp()
  )
);

grant select on public.kyc_cases, public.kyc_submissions,
  public.member_lifecycle_states, public.member_timeline_events,
  public.transaction_receipts, public.experiment_assignments to authenticated;
create policy kyc_cases_select_own on public.kyc_cases for select to authenticated
using ((select auth.uid()) = user_id);
create policy kyc_submissions_select_own on public.kyc_submissions for select to authenticated
using ((select auth.uid()) = user_id);
create policy member_lifecycle_states_select_own
on public.member_lifecycle_states for select to authenticated
using ((select auth.uid()) = user_id);
create policy member_timeline_events_select_own
on public.member_timeline_events for select to authenticated
using ((select auth.uid()) = user_id);
create policy transaction_receipts_select_own
on public.transaction_receipts for select to authenticated
using ((select auth.uid()) = user_id);
create policy experiment_assignments_select_own
on public.experiment_assignments for select to authenticated
using ((select auth.uid()) = user_id);

comment on table public.ledger_transactions is
  'Authoritative balanced journal headers. wallet_ledger remains a user-facing projection.';
comment on table public.outbox_events is
  'Transactional, versioned post-commit work. Producers write this in the domain transaction.';
comment on table public.trial_reward_conversions is
  'One-time real KRW welcome conversion, hard-capped at 5000 and never funding-gated.';
comment on table public.referral_qualifications is
  'Versioned automatic referral decisions; shared IP alone is never sufficient rejection evidence.';
comment on table public.product_catalog_versions is
  'AI-assisted sourced catalog proposals require operator approval before publication.';
comment on table public.security_events is
  'Server-only security telemetry. trusted_client_ip must come from the trusted proxy adapter.';

commit;
