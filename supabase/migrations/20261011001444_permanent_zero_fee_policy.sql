begin;

-- Direct human instruction, 2026-10-11: platform fees are permanently zero.
-- Historical sealed rows and amount-plus-fee reconciliation remain unchanged.
-- Trigger boundaries apply prospectively; old pending fee-bearing requests must
-- use the existing cancellation/release command and a new zero-fee request.
create function app_private.enforce_permanent_zero_fee()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_config jsonb;
begin
  if tg_table_schema = 'public' and tg_table_name = 'withdrawal_policies' then
    if new.fee_atomic <> 0 then
      raise exception using errcode = '22023', message = 'PLATFORM_FEES_PERMANENTLY_DISABLED';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'withdrawal_requests' then
    if (tg_op = 'INSERT' and new.fee_atomic <> 0)
      or (tg_op = 'UPDATE' and new.fee_atomic is distinct from old.fee_atomic) then
      raise exception using errcode = '22023', message = 'PLATFORM_FEES_PERMANENTLY_DISABLED';
    end if;
    if tg_op = 'UPDATE' and old.fee_atomic <> 0
      and new.status is distinct from old.status
      and new.status::text in ('PROCESSING', 'ADMIN_PROCESSING',
        'EXTERNAL_SENT_RECORDED', 'LEDGER_FINALIZED', 'COMPLETED')
      and not exists (select 1 from public.withdrawal_external_sends s
        where s.withdrawal_id = old.id) then
      raise exception using errcode = '55000', message = 'LEGACY_FEE_WITHDRAWAL_REQUIRES_CANCELLATION';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'withdrawal_external_sends' then
    if exists (select 1 from public.withdrawal_requests r
      where r.id = new.withdrawal_id and r.fee_atomic <> 0) then
      raise exception using errcode = '55000', message = 'LEGACY_FEE_WITHDRAWAL_REQUIRES_CANCELLATION';
    end if;
  elsif tg_table_schema = 'app_private' and tg_table_name = 'economy_policy_versions' then
    v_config := new.config;
  elsif tg_table_schema = 'app_private' and tg_table_name = 'economy_policy_receipts' then
    select p.config into v_config from app_private.economy_policy_versions p
      where p.id = new.policy_id;
  else
    raise exception using errcode = '55000', message = 'ZERO_FEE_TRIGGER_TARGET_INVALID';
  end if;
  if v_config is not null then
    if jsonb_typeof(v_config->'platformFeesKrw') is distinct from 'object' then
      raise exception using errcode = '22023', message = 'PLATFORM_FEES_PERMANENTLY_DISABLED';
    end if;
    if exists (select 1 from jsonb_each_text(v_config->'platformFeesKrw') f
      where f.value is distinct from '0') then
      raise exception using errcode = '22023', message = 'PLATFORM_FEES_PERMANENTLY_DISABLED';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.enforce_permanent_zero_fee()
  from public, anon, authenticated, service_role;

create trigger withdrawal_policies_zero_fee_insert
  before insert on public.withdrawal_policies
  for each row execute function app_private.enforce_permanent_zero_fee();
create trigger withdrawal_requests_zero_fee_boundary
  before insert or update of fee_atomic, status on public.withdrawal_requests
  for each row execute function app_private.enforce_permanent_zero_fee();
create trigger withdrawal_external_sends_zero_fee_boundary
  before insert on public.withdrawal_external_sends
  for each row execute function app_private.enforce_permanent_zero_fee();
create trigger economy_policy_versions_zero_fee_insert
  before insert on app_private.economy_policy_versions
  for each row execute function app_private.enforce_permanent_zero_fee();
create trigger economy_policy_receipts_zero_fee_insert
  before insert on app_private.economy_policy_receipts
  for each row execute function app_private.enforce_permanent_zero_fee();

-- Append zero-fee successors in original version order for affected routes.
-- Include scheduled zero-fee versions so a new current successor cannot hide
-- their later limits/enablement. Expired rows are retained without reactivation.
-- Exact original receipt rows remain untouched; the unique effective timestamp
-- advances only to the next available microsecond on a copied policy.
do $$
declare
  v_policy public.withdrawal_policies%rowtype;
  v_next_version integer;
  v_currency public.currency_code;
  v_destination text;
  v_effective timestamptz;
begin
  for v_policy in
    select p.*
    from public.withdrawal_policies p
    where (p.expires_at is null or p.expires_at > statement_timestamp())
      and exists (select 1 from public.withdrawal_policies affected
        where affected.currency = p.currency
          and affected.destination_type = p.destination_type
          and affected.fee_atomic <> 0
          and (affected.expires_at is null or affected.expires_at > statement_timestamp()))
    order by p.currency, p.destination_type, p.version
  loop
    if v_currency is distinct from v_policy.currency
      or v_destination is distinct from v_policy.destination_type then
      v_currency := v_policy.currency;
      v_destination := v_policy.destination_type;
      select max(p.version) into v_next_version from public.withdrawal_policies p
        where p.currency = v_currency and p.destination_type = v_destination;
    end if;
    v_effective := greatest(statement_timestamp(), v_policy.effective_at);
    while exists (select 1 from public.withdrawal_policies p
      where p.currency = v_currency and p.destination_type = v_destination
        and p.effective_at = v_effective) loop
      v_effective := v_effective + interval '1 microsecond';
    end loop;
    if v_policy.expires_at is not null and v_effective >= v_policy.expires_at then
      continue;
    end if;
    v_next_version := v_next_version + 1;
    v_policy.id := gen_random_uuid();
    v_policy.version := v_next_version;
    v_policy.fee_atomic := 0;
    v_policy.effective_at := v_effective;
    v_policy.created_at := statement_timestamp();
    insert into public.withdrawal_policies select v_policy.*;
  end loop;
end;
$$;

commit;
