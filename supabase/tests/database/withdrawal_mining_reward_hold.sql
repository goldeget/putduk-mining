begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 검증된 채굴 수익이 수수료 0인 전액을 덮으면 그 수익만 예약하고 hold한다.
-- 부족하면 원금으로 채우지 않는다. BONUS와 지갑 라벨은 일반 출처가 아니다.
-- 수익을 모두 예약한 뒤의 원금 전액 경로는 기존 hold를 유지한다.

create temporary table reward_hold_ctx (
  member_id uuid,
  short_id uuid,
  label_id uuid,
  bonus_id uuid,
  fee_id uuid,
  admin_id uuid,
  bank_id uuid,
  short_bank_id uuid,
  label_bank_id uuid,
  bonus_bank_id uuid,
  fee_bank_id uuid,
  old_movement_id uuid,
  mid_movement_id uuid,
  tie_low_movement_id uuid,
  tie_high_movement_id uuid,
  withdrawal_id uuid,
  rest_withdrawal_id uuid,
  principal_withdrawal_id uuid,
  program_id uuid
);
insert into reward_hold_ctx(
  member_id, short_id, label_id, bonus_id, fee_id, admin_id,
  old_movement_id, mid_movement_id, tie_low_movement_id, tie_high_movement_id
) values (
  '10620000-0000-4000-8000-000000000301',
  '10620000-0000-4000-8000-000000000302',
  '10620000-0000-4000-8000-000000000303',
  '10620000-0000-4000-8000-000000000304',
  '10620000-0000-4000-8000-000000000306',
  '10620000-0000-4000-8000-000000000305',
  '10620000-0000-4000-8000-000000000011',
  '10620000-0000-4000-8000-000000000012',
  '10620000-0000-4000-8000-000000000021',
  '10620000-0000-4000-8000-000000000022'
);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
select person, 'authenticated', 'authenticated', person::text || '@reward-hold.putduk.test', '',
  statement_timestamp(), '{}', '{}', statement_timestamp(), statement_timestamp(), '', '', '', ''
from reward_hold_ctx
cross join lateral unnest(array[member_id, short_id, label_id, bonus_id, fee_id, admin_id]) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN', admin_id from reward_hold_ctx;
select public.bootstrap_user(person)
from reward_hold_ctx
cross join lateral unnest(array[member_id, short_id, label_id, bonus_id, fee_id]) as person;

insert into public.withdrawal_policies(
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select 'KRW', 'KRW_BANK', 1062101, true, 1, 0, '{}'::jsonb,
  statement_timestamp() - interval '1 hour', admin_id, false
from reward_hold_ctx;

insert into public.withdrawal_destinations(
  user_id, destination_type, encrypted_value, value_fingerprint, display_hint,
  verification_status, verified_at, protection_until
)
select person, 'KRW_BANK', decode(repeat('ab', 32), 'hex'),
  encode(extensions.digest(person::text || 'KRW_BANK', 'sha256'), 'hex'),
  '수익 시험 계좌', 'VERIFIED',
  statement_timestamp() - interval '2 days', statement_timestamp() - interval '1 day'
from reward_hold_ctx
cross join lateral unnest(array[member_id, short_id, label_id, bonus_id, fee_id]) as person;
update reward_hold_ctx set bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = reward_hold_ctx.member_id;
update reward_hold_ctx set short_bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = reward_hold_ctx.short_id;
update reward_hold_ctx set label_bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = reward_hold_ctx.label_id;
update reward_hold_ctx set bonus_bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = reward_hold_ctx.bonus_id;
update reward_hold_ctx set fee_bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = reward_hold_ctx.fee_id;

insert into public.ledger_accounts(
  code, currency, account_class, normal_side, owner_user_id, is_controlled_asset
)
select 'USER:' || upper(person::text) || ':KRW:LIABILITY',
  'KRW', 'LIABILITY', 'CREDIT', person, false
from reward_hold_ctx
cross join lateral unnest(array[member_id, short_id, fee_id]) as person
on conflict (code) do nothing;

create function pg_temp.plant_verified_mining_reward(
  p_user_id uuid,
  p_movement_id uuid,
  p_amount bigint,
  p_effective_at timestamptz,
  p_recorded_at timestamptz,
  p_key text
) returns void
language plpgsql
as $$
declare
  v_credit uuid := gen_random_uuid();
  v_journal uuid := gen_random_uuid();
  v_wallet uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_wallet_account uuid;
begin
  select account.id into v_wallet_account
  from public.wallet_accounts as account
  where account.user_id = p_user_id and account.currency = 'KRW' and account.closed_at is null;
  insert into public.ledger_transactions(
    id, category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, posted_at
  ) values (
    v_journal, 'MINING_REWARD', 'KRW', p_key || ':ledger', 'mining_reward_credit', v_credit,
    p_user_id, v_request, v_correlation, 'verified mining reward credit', p_effective_at
  );
  insert into public.ledger_entries(transaction_id, account_id, sequence, side, amount_atomic)
  values
    (v_journal, (select id from public.ledger_accounts where code = 'PUTDUK:MINING_REWARD_EXPENSE:KRW'),
      0, 'DEBIT', p_amount),
    (v_journal, (select id from public.ledger_accounts
      where code = 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'),
      1, 'CREDIT', p_amount);
  insert into public.wallet_ledger(
    id, wallet_account_id, user_id, direction, entry_type, amount_atomic,
    idempotency_key, reference_type, reference_id
  ) values (
    v_wallet, v_wallet_account, p_user_id, 'CREDIT', 'MINING_REWARD', p_amount,
    p_key || ':wallet', 'mining_reward_credit', v_credit
  );
  insert into public.outbox_events(
    id, event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    v_event, 'MINING_REWARD_CREDITED.v1', 1, 'mining_reward_credit', v_credit, p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_atomic', p_amount,
      'currency', 'KRW',
      'ledger_transaction_id', v_journal,
      'wallet_ledger_id', v_wallet
    ),
    v_correlation, v_request, p_key || ':event'
  );
  insert into public.mining_reward_credits(
    id, user_id, amount_atomic, ledger_transaction_id, wallet_ledger_id,
    source_event_id, effective_at
  ) values (
    v_credit, p_user_id, p_amount, v_journal, v_wallet, v_event, p_effective_at
  );
  insert into public.money_source_movements(
    id, user_id, source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at, recorded_at
  ) values (
    p_movement_id, p_user_id, 'MINING_REWARD', 'CREDIT', 'MINING_REWARD', p_amount,
    v_journal, v_wallet, v_event, p_effective_at, p_recorded_at
  );
end;
$$;

select pg_temp.plant_verified_mining_reward(
  member_id, old_movement_id, 4000,
  statement_timestamp() - interval '3 hours',
  statement_timestamp() - interval '3 hours',
  'reward-credit-old-301'
) from reward_hold_ctx;
select pg_temp.plant_verified_mining_reward(
  member_id, mid_movement_id, 6000,
  statement_timestamp() - interval '2 hours',
  statement_timestamp() - interval '2 hours',
  'reward-credit-mid-301'
) from reward_hold_ctx;
select pg_temp.plant_verified_mining_reward(
  member_id, tie_low_movement_id, 1000,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  'reward-credit-low-301'
) from reward_hold_ctx;
select pg_temp.plant_verified_mining_reward(
  member_id, tie_high_movement_id, 1000,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  'reward-credit-high-301'
) from reward_hold_ctx;
select pg_temp.plant_verified_mining_reward(
  short_id, '10620000-0000-4000-8000-000000000031', 2000,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  'reward-credit-short-302'
) from reward_hold_ctx;
select pg_temp.plant_verified_mining_reward(
  fee_id, '10620000-0000-4000-8000-000000000032', 4000,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  'reward-credit-fee-306'
) from reward_hold_ctx;

grant select, update on reward_hold_ctx to service_role;
set local role service_role;
select public.approve_deposit_request(
  public.create_deposit_request(member_id, 'KRW', 10000, 'reward-hold-deposit-301'),
  admin_id, 10000, 'reward-hold-credit-301', 'reward member principal', gen_random_uuid()
) from reward_hold_ctx;
select public.approve_deposit_request(
  public.create_deposit_request(short_id, 'KRW', 8000, 'reward-hold-deposit-302'),
  admin_id, 8000, 'reward-hold-credit-302', 'short member principal', gen_random_uuid()
) from reward_hold_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'principal deposits finish their original receipts');
set constraints deposit_requests_money_source_complete deferred;

update reward_hold_ctx
set withdrawal_id = public.request_krw_withdrawal(
  member_id, bank_id, 9000, 'reward-hold-span-0001');
select is(
  public.request_krw_withdrawal(
    (select member_id from reward_hold_ctx),
    (select bank_id from reward_hold_ctx),
    9000,
    'reward-hold-span-0001'
  ),
  (select withdrawal_id from reward_hold_ctx),
  'the same mining reward request returns the original hold'
);
reset role;

select is(
  (select status from public.withdrawal_requests where id = (select withdrawal_id from reward_hold_ctx)),
  'HELD',
  'verified mining reward that covers the fee-free amount reaches hold'
);
select is(
  (select count(*)::integer from public.ledger_transactions
    where idempotency_key = 'reward-hold-span-0001:hold'),
  1,
  'retry does not post a second mining reward hold'
);
select ok(
  (
    select count(*)::integer = 4
      and sum(reservation.amount_atomic) = 9000
      and bool_and(movement.source_bucket = 'MINING_REWARD')
      and bool_and(movement.movement_kind = 'CREDIT')
    from public.mining_reward_withdrawal_reservations as reservation
    join public.money_source_movements as movement
      on movement.id = reservation.credit_movement_id
    where reservation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id
      from public.withdrawal_requests
      where id = (select withdrawal_id from reward_hold_ctx)
    )
  ),
  'the hold reserves only verified mining reward credits'
);
select is(
  (select reservation.credit_movement_id
    from public.mining_reward_withdrawal_reservations as reservation
    where reservation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select withdrawal_id from reward_hold_ctx))
      and reservation.ordinal = 0),
  (select tie_high_movement_id from reward_hold_ctx),
  'the newest effective time and higher id is reserved first'
);
select is(
  (select reservation.amount_atomic
    from public.mining_reward_withdrawal_reservations as reservation
    where reservation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select withdrawal_id from reward_hold_ctx))
      and reservation.credit_movement_id = (select old_movement_id from reward_hold_ctx)),
  1000::bigint,
  'partial allocation stays inside the older mining reward credit'
);
select is(
  (select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
    from public.funding_principal_recovery_allocations as allocation
    where allocation.user_id = (select member_id from reward_hold_ctx)),
  0::bigint,
  'a full mining reward hold does not reserve principal'
);
select is(
  (select count(*)::integer from public.wallet_ledger
    where user_id = (select member_id from reward_hold_ctx) and direction = 'DEBIT'),
  0,
  'mining reward hold does not debit the wallet projection'
);
select is(
  (select count(*)::integer from public.money_source_movements
    where user_id = (select member_id from reward_hold_ctx)
      and movement_kind in ('RESERVE', 'RELEASE', 'FINALIZE', 'REVERSE')),
  0,
  'mining reward hold does not write release finalize or reverse source rows'
);

set local role service_role;
select throws_ok(
  $$select public.request_krw_withdrawal(member_id, bank_id, 5000, 'reward-hold-mixed-0002')
    from reward_hold_ctx$$,
  '55000', 'WITHDRAWAL_SOURCE_INSUFFICIENT',
  'a short mining reward is not filled from principal'
);
select is(
  (select count(*)::integer from public.withdrawal_requests
    where user_id = (select member_id from reward_hold_ctx)),
  1,
  'the rejected mixed request leaves the mining reward hold alone'
);
update reward_hold_ctx
set rest_withdrawal_id = public.request_krw_withdrawal(
  member_id, bank_id, 3000, 'reward-hold-rest-0003');
update reward_hold_ctx
set principal_withdrawal_id = public.request_krw_withdrawal(
  member_id, bank_id, 2000, 'reward-hold-principal-0004');
reset role;

select is(
  (select status from public.withdrawal_requests where id = (select rest_withdrawal_id from reward_hold_ctx)),
  'HELD',
  'the remaining verified mining reward still holds on its own'
);
select is(
  (select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
    from public.funding_principal_recovery_allocations as allocation
    where allocation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select rest_withdrawal_id from reward_hold_ctx))),
  0::bigint,
  'the remaining mining reward hold still does not touch principal'
);
select is(
  (select status from public.withdrawal_requests
    where id = (select principal_withdrawal_id from reward_hold_ctx)),
  'HELD',
  'principal hold remains available after mining reward is fully reserved'
);
select is(
  (select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
    from public.funding_principal_recovery_allocations as allocation
    where allocation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select principal_withdrawal_id from reward_hold_ctx))),
  app_private.funding_principal_micro_krw(2000),
  'the later full principal path uses newest-first principal only'
);
select is(
  (select count(*)::integer from public.mining_reward_withdrawal_reservations
    where hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select principal_withdrawal_id from reward_hold_ctx))),
  0,
  'the principal path does not reserve mining reward'
);

set local role service_role;
select throws_ok(
  $$select public.request_krw_withdrawal(short_id, short_bank_id, 5000, 'reward-hold-short-0005')
    from reward_hold_ctx$$,
  '55000', 'WITHDRAWAL_SOURCE_INSUFFICIENT',
  'principal cannot complete a short mining reward withdrawal'
);
select throws_ok(
  $$select public.request_krw_withdrawal(label_id, label_bank_id, 1000, 'reward-hold-label-0006')
    from reward_hold_ctx$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'an empty wallet is not a verified mining reward or principal source'
);
reset role;
insert into public.wallet_ledger(
  wallet_account_id, user_id, direction, entry_type, amount_atomic,
  idempotency_key, reference_type, reference_id
)
select id, user_id, 'CREDIT', 'MINING_REWARD', 8000, 'reward-hold-unverified-label', 'test', user_id
from public.wallet_accounts
where user_id = (select label_id from reward_hold_ctx) and currency = 'KRW';
set local role service_role;
select throws_ok(
  $$select public.request_krw_withdrawal(label_id, label_bank_id, 1000, 'reward-hold-label-0007')
    from reward_hold_ctx$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'an unverified mining reward label still cannot hold'
);
reset role;

with program as (
  insert into public.trial_programs(name, version, is_enabled, duration_seconds, target_reward_krw,
    first_result_target_seconds, first_world_id, completion_copy, effective_at)
  select 'reward-hold-bonus', 1, false, 3600, 5000, 60, id, '체험 완료',
    statement_timestamp() - interval '2 hours'
  from public.asset_worlds where code = 'KOREA'
  returning id
)
update reward_hold_ctx set program_id = program.id from program;
insert into public.trial_accounts(
  user_id, trial_program_id, trial_program_version, world_id, status,
  started_at, expires_at, last_settled_at, quota_consumed_bps, reward_atomic, target_reward_krw
)
select bonus_id, program_id, 1, program.first_world_id, 'COMPLETED',
  statement_timestamp() - interval '1 hour', statement_timestamp(), statement_timestamp(),
  10000, 5000, 5000
from reward_hold_ctx
join public.trial_programs as program on program.id = reward_hold_ctx.program_id;
insert into public.trial_completions(
  trial_account_id, user_id, reason, final_quota_bps, final_reward_atomic, completed_at
)
select account.id, account.user_id, 'QUOTA', 10000, 5000, statement_timestamp()
from public.trial_accounts as account
where account.user_id = (select bonus_id from reward_hold_ctx);
insert into public.kyc_cases(user_id, status, risk_level, decided_at, reviewed_by)
select bonus_id, 'APPROVED', 'LOW', statement_timestamp(), admin_id from reward_hold_ctx;
set local role service_role;
select public.convert_trial_welcome_reward(
  bonus_id, 'reward-hold-bonus-304', gen_random_uuid(), 1, 'reward-hold-bonus-risk'
) from reward_hold_ctx;
select lives_ok($$set constraints trial_reward_conversions_money_source_complete immediate$$,
  'welcome bonus completes without becoming a general withdrawal source');
set constraints trial_reward_conversions_money_source_complete deferred;
select throws_ok(
  $$select public.request_krw_withdrawal(bonus_id, bonus_bank_id, 1000, 'reward-hold-bonus-0008')
    from reward_hold_ctx$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'bonus is not a general withdrawal source'
);
reset role;

insert into public.withdrawal_policies(
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select 'KRW', 'KRW_BANK', 1062102, true, 1, 50, '{}'::jsonb,
  statement_timestamp() - interval '1 hour', admin_id, false
from reward_hold_ctx;
set local role service_role;
select throws_ok(
  $$select public.request_krw_withdrawal(fee_id, fee_bank_id, 1000, 'reward-hold-fee-0009')
    from reward_hold_ctx$$,
  '55000', 'WITHDRAWAL_SOURCE_INSUFFICIENT',
  'a non-zero fee does not hold even when mining reward covers the amount'
);
reset role;
select is(
  (select count(*)::integer from public.withdrawal_requests
    where user_id = (select fee_id from reward_hold_ctx)),
  0,
  'the rejected fee request does not leave a hold'
);
select is(
  (select count(*)::integer from public.mining_settlements
    where user_id in (
      (select member_id from reward_hold_ctx),
      (select short_id from reward_hold_ctx),
      (select fee_id from reward_hold_ctx)
    )),
  0,
  'this path does not reactivate mining settlement'
);

select * from finish();
rollback;
