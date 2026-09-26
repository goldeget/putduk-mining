begin;

create table public.withdrawal_policies (
  id uuid primary key default gen_random_uuid(),
  currency public.currency_code not null,
  destination_type text not null,
  version integer not null,
  is_enabled boolean not null default false,
  minimum_amount_atomic bigint not null,
  fee_atomic bigint not null default 0,
  destination_config jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null,
  expires_at timestamptz,
  approved_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint withdrawal_policies_destination_type_format
    check (destination_type ~ '^[A-Z][A-Z0-9_]{2,31}$'),
  constraint withdrawal_policies_version_positive check (version > 0),
  constraint withdrawal_policies_minimum_positive check (minimum_amount_atomic > 0),
  constraint withdrawal_policies_fee_non_negative check (fee_atomic >= 0),
  constraint withdrawal_policies_config_object
    check (jsonb_typeof(destination_config) = 'object'),
  constraint withdrawal_policies_time_order
    check (expires_at is null or expires_at > effective_at),
  constraint withdrawal_policies_currency_destination_version_unique
    unique (currency, destination_type, version),
  constraint withdrawal_policies_currency_destination_effective_unique
    unique (currency, destination_type, effective_at)
);

create index withdrawal_policies_effective_idx
  on public.withdrawal_policies (currency, destination_type, effective_at desc);

create trigger withdrawal_policies_prevent_update_delete
before update or delete on public.withdrawal_policies
for each row execute function app_private.prevent_row_mutation();

alter table public.withdrawal_policies enable row level security;
alter table public.withdrawal_policies force row level security;

alter table public.withdrawal_requests
  add column withdrawal_policy_id uuid not null
    references public.withdrawal_policies (id) on delete restrict;

drop function public.create_withdrawal_request(
  uuid,
  uuid,
  bigint,
  bigint,
  text,
  jsonb,
  text
);

create function public.create_withdrawal_request(
  p_user_id uuid,
  p_wallet_account_id uuid,
  p_withdrawal_policy_id uuid,
  p_amount_atomic bigint,
  p_destination_type text,
  p_destination_snapshot jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_balance bigint;
  v_currency public.currency_code;
  v_held bigint;
  v_policy public.withdrawal_policies%rowtype;
  v_request_id uuid;
begin
  if p_amount_atomic <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_AMOUNT';
  end if;
  if char_length(btrim(coalesce(p_destination_type, ''))) not between 3 and 32
    or jsonb_typeof(p_destination_snapshot) <> 'object'
    or not (p_destination_snapshot ? 'encrypted')
    or not (p_destination_snapshot ? 'display')
    or octet_length(p_destination_snapshot::text) > 8192
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_DESTINATION';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select request.id
  into v_request_id
  from public.withdrawal_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key;

  if v_request_id is not null then
    return v_request_id;
  end if;

  select account.currency
  into v_currency
  from public.wallet_accounts as account
  where account.id = p_wallet_account_id
    and account.user_id = p_user_id
    and account.closed_at is null
  for update;

  if v_currency is null then
    raise exception using errcode = '22023', message = 'WALLET_ACCOUNT_NOT_FOUND';
  end if;

  select policy.*
  into v_policy
  from public.withdrawal_policies as policy
  where policy.id = p_withdrawal_policy_id
    and policy.currency = v_currency
    and policy.destination_type = p_destination_type
    and policy.is_enabled
    and policy.effective_at <= statement_timestamp()
    and (policy.expires_at is null or policy.expires_at > statement_timestamp());

  if v_policy.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_POLICY_UNAVAILABLE';
  end if;

  if p_amount_atomic < v_policy.minimum_amount_atomic then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_BELOW_MINIMUM';
  end if;

  select coalesce(sum(
    case
      when ledger.direction = 'CREDIT' then ledger.amount_atomic
      else -ledger.amount_atomic
    end
  ), 0)::bigint
  into v_balance
  from public.wallet_ledger as ledger
  where ledger.wallet_account_id = p_wallet_account_id;

  select coalesce(sum(request.amount_atomic + request.fee_atomic), 0)::bigint
  into v_held
  from public.withdrawal_requests as request
  where request.wallet_account_id = p_wallet_account_id
    and request.status in ('REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING');

  if v_balance - v_held < p_amount_atomic + v_policy.fee_atomic then
    raise exception using errcode = '22003', message = 'INSUFFICIENT_AVAILABLE_BALANCE';
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id,
    withdrawal_policy_id,
    user_id,
    currency,
    amount_atomic,
    fee_atomic,
    destination_type,
    destination_snapshot,
    idempotency_key
  ) values (
    p_wallet_account_id,
    v_policy.id,
    p_user_id,
    v_currency,
    p_amount_atomic,
    v_policy.fee_atomic,
    p_destination_type,
    p_destination_snapshot,
    p_idempotency_key
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.create_withdrawal_request(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb,
  text
) from public, anon, authenticated;
grant execute on function public.create_withdrawal_request(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb,
  text
) to service_role;

comment on table public.withdrawal_policies is
  'Append-only operator-approved fee, minimum and destination rules. A later disabled version closes a route without rewriting history.';
comment on column public.withdrawal_requests.destination_snapshot is
  'Contains only masked display data and an application-encrypted destination envelope.';
comment on function public.create_withdrawal_request(
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  jsonb,
  text
) is 'Service-only policy-bound withdrawal hold creation. Fees are read from the approved policy, never trusted from the client.';

commit;
