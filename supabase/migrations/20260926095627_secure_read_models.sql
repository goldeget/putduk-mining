begin;

create view public.wallet_balance_snapshots
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
    and request.status in ('REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING')
) as holds on true;

create view public.trial_account_snapshots
with (security_invoker = true)
as
select
  account.id as trial_account_id,
  account.user_id,
  account.status,
  world.code as world_code,
  world.display_name_ko as world_name_ko,
  account.quota_consumed_bps,
  account.reward_atomic::text as reward_atomic,
  account.target_reward_krw::text as target_reward_krw,
  account.started_at,
  account.expires_at,
  account.last_settled_at,
  case
    when account.expires_at is null then null
    else greatest(
      0,
      floor(extract(epoch from account.expires_at - statement_timestamp()))
    )::bigint
  end as remaining_seconds,
  active_session.id as active_session_id,
  completion.reason as completion_reason,
  completion.completed_at
from public.trial_accounts as account
join public.asset_worlds as world on world.id = account.world_id
left join lateral (
  select session.id
  from public.trial_sessions as session
  where session.trial_account_id = account.id
    and session.ended_at is null
  order by session.started_at desc
  limit 1
) as active_session on true
left join public.trial_completions as completion
  on completion.trial_account_id = account.id;

create view public.mining_active_session_snapshots
with (security_invoker = true)
as
select
  session.id as mining_session_id,
  session.user_id,
  farm.id as mining_farm_id,
  world.code as world_code,
  world.display_name_ko as world_name_ko,
  session.status,
  session.started_at,
  session.last_settled_at,
  greatest(
    0,
    floor(extract(epoch from statement_timestamp() - session.last_settled_at))
  )::bigint as unsettled_seconds,
  (
    select count(*)
    from public.mining_equipment as equipment
    where equipment.mining_farm_id = farm.id
      and equipment.unequipped_at is null
  )::integer as active_equipment_count
from public.mining_sessions as session
join public.mining_farms as farm on farm.id = session.mining_farm_id
join public.asset_worlds as world on world.id = farm.world_id
where session.ended_at is null;

revoke all on public.wallet_balance_snapshots from public, anon;
revoke all on public.trial_account_snapshots from public, anon;
revoke all on public.mining_active_session_snapshots from public, anon;

grant select on
  public.wallet_balance_snapshots,
  public.trial_account_snapshots,
  public.mining_active_session_snapshots
to authenticated;

comment on view public.wallet_balance_snapshots is
  'Security-invoker, RLS-backed ledger-derived balances. Atomic amounts are text to preserve precision.';
comment on view public.trial_account_snapshots is
  'Security-invoker, RLS-backed trial state calculated with database server time.';
comment on view public.mining_active_session_snapshots is
  'Security-invoker, RLS-backed active mining session timing without per-second writes.';

commit;
