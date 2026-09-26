begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create type public.app_role as enum (
  'SUPER_ADMIN',
  'ADMIN',
  'CONTENT_ADMIN',
  'SUPPORT_ADMIN',
  'VIEWER'
);

create type public.world_code as enum ('KOREA', 'USA', 'GOLD', 'SILVER', 'CRYPTO');
create type public.trial_status as enum ('READY', 'ACTIVE', 'COMPLETED', 'EXPIRED');
create type public.mining_status as enum (
  'NORMAL',
  'REDUCED',
  'MAINTENANCE',
  'PARTIAL_STOP',
  'STOPPED'
);
create type public.ledger_entry_type as enum (
  'DEPOSIT',
  'WITHDRAWAL',
  'MINING_REWARD',
  'EVENT_REWARD',
  'UPGRADE_COST',
  'REFUND',
  'REVERSAL',
  'ADMIN_ADJUSTMENT'
);
create type public.ledger_direction as enum ('CREDIT', 'DEBIT');
create type public.currency_code as enum ('KRW', 'USDT');
create type public.deposit_status as enum (
  'REQUESTED',
  'AWAITING_TRANSFER',
  'REVIEWING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);
create type public.withdrawal_status as enum (
  'REQUESTED',
  'REVIEWING',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
  'CANCELLED'
);
create type public.system_job_status as enum (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

create function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create function app_private.prevent_row_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

revoke all on function app_private.set_updated_at() from public, anon, authenticated;
revoke all on function app_private.prevent_row_mutation() from public, anon, authenticated;

comment on schema app_private is
  'Non-exposed helpers. No direct Data API access is granted.';
comment on function app_private.prevent_row_mutation() is
  'Rejects UPDATE and DELETE operations on append-only records.';

commit;
