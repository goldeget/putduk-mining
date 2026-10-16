-- QA PROPOSAL ONLY: reviewed CLI migration creation/apply belongs to Primary.
-- One per-journal scan; LEFT JOIN retains unmatched entry rows in exact count.
create or replace function app_private.withdrawal_coverage_entries_verified(
  p_journal_id uuid, p_user_id uuid, p_amount_atomic bigint, p_phase text
) returns boolean
language sql stable security invoker set search_path = pg_catalog
as $$
  select p_amount_atomic > 0 and p_phase in ('HOLD', 'RELEASE', 'FINALIZE')
    and count(*) = 2
    and coalesce(bool_or(
      entry.sequence = 0
        and entry.side = 'DEBIT' and entry.amount_atomic = p_amount_atomic
        and account.currency = 'KRW' and not account.is_controlled_asset
        and account.normal_side = 'CREDIT'
        and account.code = case when p_phase = 'HOLD'
          then 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'
          else 'PUTDUK:WITHDRAWAL_HOLD:KRW' end
        and account.account_class::text = case when p_phase = 'HOLD' then 'LIABILITY' else 'CLEARING' end
        and account.owner_user_id is not distinct from case when p_phase = 'HOLD' then p_user_id end
    ), false)
    and coalesce(bool_or(
      entry.sequence = 1
        and entry.side = 'CREDIT' and entry.amount_atomic = p_amount_atomic
        and account.currency = 'KRW'
        and account.code = case p_phase
          when 'HOLD' then 'PUTDUK:WITHDRAWAL_HOLD:KRW'
          when 'RELEASE' then 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'
          else 'PUTDUK:OPERATING_CASH:KRW' end
        and account.account_class::text = case p_phase
          when 'HOLD' then 'CLEARING' when 'RELEASE' then 'LIABILITY' else 'ASSET' end
        and account.normal_side::text = case when p_phase = 'FINALIZE' then 'DEBIT' else 'CREDIT' end
        and account.is_controlled_asset = (p_phase = 'FINALIZE')
        and account.owner_user_id is not distinct from case when p_phase = 'RELEASE' then p_user_id end
    ), false)
  from public.ledger_entries entry
  left join public.ledger_accounts account on account.id = entry.account_id
  where entry.transaction_id = p_journal_id;
$$;
