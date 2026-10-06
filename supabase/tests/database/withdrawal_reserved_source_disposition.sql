begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 예약된 출금이 확정되면 FINALIZE 출처 행 하나만 남고, 원장은 다시 차감하지 않는다.
-- 외부 송금 전 취소는 RELEASE 출처 행으로 그 예약만 되돌린다.
-- 같은 hold에 둘을 같이 남기지 않고, 재시도는 행을 더하지 않는다.

create temporary table disposition_ctx (
  mining_id uuid,
  principal_id uuid,
  fee_id uuid,
  admin_id uuid,
  older_movement_id uuid,
  newer_movement_id uuid,
  mining_bank_id uuid,
  principal_bank_id uuid,
  fee_bank_id uuid,
  finalize_withdrawal_id uuid,
  release_withdrawal_id uuid,
  replay_withdrawal_id uuid,
  finalize_tx uuid,
  release_tx uuid,
  principal_finalize_withdrawal_id uuid,
  principal_release_withdrawal_id uuid,
  principal_finalize_tx uuid,
  principal_release_tx uuid,
  journal_count integer
);
insert into disposition_ctx(
  mining_id, principal_id, fee_id, admin_id, older_movement_id, newer_movement_id
) values (
  '10630000-0000-4000-8000-000000000311',
  '10630000-0000-4000-8000-000000000312',
  '10630000-0000-4000-8000-000000000313',
  '10630000-0000-4000-8000-000000000319',
  '10630000-0000-4000-8000-000000000011',
  '10630000-0000-4000-8000-000000000012'
);

insert into auth.users(
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person, 'authenticated', 'authenticated', person::text || '@source-disposition.putduk.test', '',
  statement_timestamp(), '{}', '{}', statement_timestamp(), statement_timestamp(), '', '', '', ''
from disposition_ctx
cross join lateral unnest(array[mining_id, principal_id, fee_id, admin_id]) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN', admin_id from disposition_ctx;
select public.bootstrap_user(person)
from disposition_ctx
cross join lateral unnest(array[mining_id, principal_id, fee_id]) as person;

insert into public.withdrawal_policies(
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select 'KRW', 'KRW_BANK', 1063101, true, 1, 0, '{}'::jsonb,
  statement_timestamp() - interval '1 hour', admin_id, false
from disposition_ctx;

insert into public.withdrawal_destinations(
  user_id, destination_type, encrypted_value, value_fingerprint, display_hint,
  verification_status, verified_at, protection_until
)
select person, 'KRW_BANK', decode(repeat('ab', 32), 'hex'),
  encode(extensions.digest(person::text || 'KRW_BANK', 'sha256'), 'hex'),
  '출처 시험 계좌', 'VERIFIED',
  statement_timestamp() - interval '2 days', statement_timestamp() - interval '1 day'
from disposition_ctx
cross join lateral unnest(array[mining_id, principal_id, fee_id]) as person;
update disposition_ctx set mining_bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = disposition_ctx.mining_id;
update disposition_ctx set principal_bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = disposition_ctx.principal_id;
update disposition_ctx set fee_bank_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = disposition_ctx.fee_id;

insert into public.ledger_accounts(
  code, currency, account_class, normal_side, owner_user_id, is_controlled_asset
)
select 'USER:' || upper(person::text) || ':KRW:LIABILITY',
  'KRW', 'LIABILITY', 'CREDIT', person, false
from disposition_ctx
cross join lateral unnest(array[mining_id, fee_id]) as person
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
  mining_id, older_movement_id, 3000,
  statement_timestamp() - interval '3 hours',
  statement_timestamp() - interval '3 hours',
  'disposition-credit-old-311'
) from disposition_ctx;
select pg_temp.plant_verified_mining_reward(
  mining_id, newer_movement_id, 5000,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  'disposition-credit-new-311'
) from disposition_ctx;
select pg_temp.plant_verified_mining_reward(
  fee_id, gen_random_uuid(), 4000,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  'disposition-credit-fee-313'
) from disposition_ctx;

grant select, update on disposition_ctx to service_role;
set local role service_role;
update disposition_ctx
set finalize_withdrawal_id = public.request_krw_withdrawal(
  mining_id, mining_bank_id, 6000, 'disposition-mine-finalize-0001');
reset role;

select is(
  (select reservation.credit_movement_id
    from public.mining_reward_withdrawal_reservations as reservation
    where reservation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select finalize_withdrawal_id from disposition_ctx))
      and reservation.ordinal = 0),
  (select newer_movement_id from disposition_ctx),
  'reservation order stays newest effective time first'
);
select is(
  (select coalesce(sum(reservation.amount_atomic), 0)::bigint
    from public.mining_reward_withdrawal_reservations as reservation
    where reservation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select finalize_withdrawal_id from disposition_ctx))),
  6000::bigint,
  'the hold reserves the full mining reward amount'
);

set local role service_role;
select public.record_krw_external_send(
  finalize_withdrawal_id, 'DISP-MINE-6000', 6000, admin_id,
  statement_timestamp(), 'disposition-mine-send-0001'
) from disposition_ctx;
update disposition_ctx
set finalize_tx = public.finalize_withdrawal_ledger(
  finalize_withdrawal_id, admin_id, 'disposition-mine-finalize-key');
select is(
  public.finalize_withdrawal_ledger(
    (select finalize_withdrawal_id from disposition_ctx),
    (select admin_id from disposition_ctx),
    'disposition-mine-finalize-key'
  ),
  (select finalize_tx from disposition_ctx),
  'finalize retry returns the original journal'
);
reset role;

select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id = (select mining_id from disposition_ctx)
      and movement.movement_kind = 'FINALIZE'
      and movement.source_bucket = 'MINING_REWARD'
      and movement.origin_code = 'MINING_REWARD_WITHDRAWAL_FINALIZE'
      and movement.amount_atomic = 6000
      and movement.ledger_transaction_id = (select finalize_tx from disposition_ctx)),
  1,
  'successful finalize adds one mining reward source row for the reserved amount'
);
select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id = (select mining_id from disposition_ctx)
      and movement.movement_kind = 'RELEASE'),
  0,
  'a finalized mining reward hold has no release source row'
);
select is(
  (select count(*)::integer
    from public.ledger_entries as entry
    where entry.transaction_id = (select finalize_tx from disposition_ctx)),
  2,
  'finalize source row does not add another ledger entry'
);
select is(
  (select count(*)::integer
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = 'disposition-mine-finalize-key:finalize'),
  1,
  'finalize retry does not post a second journal'
);
select is(
  (select count(*)::integer
    from public.wallet_ledger as ledger
    where ledger.user_id = (select mining_id from disposition_ctx)
      and ledger.direction = 'DEBIT'),
  1,
  'finalize source row does not debit the wallet again'
);
select is(
  app_private.verified_mining_reward_remaining_atomic(
    (select mining_id from disposition_ctx)),
  2000::bigint,
  'finalized reservation stays consumed and the unreserved reward remains'
);
select is(
  (select movement.amount_atomic
    from public.money_source_movements as movement
    where movement.id = (select older_movement_id from disposition_ctx)),
  3000::bigint,
  'finalize does not claw back the unreserved part of a verified reward'
);

set local role service_role;
select throws_ok(
  $$select public.release_withdrawal_hold(
      finalize_withdrawal_id, admin_id, '송금 후 취소는 막는다',
      'disposition-mine-late-release', 'CANCELLED')
    from disposition_ctx$$,
  '55000', 'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND',
  'external send keeps release from adding a second disposition'
);
update disposition_ctx
set release_withdrawal_id = public.request_krw_withdrawal(
  mining_id, mining_bank_id, 2000, 'disposition-mine-release-0002');
update disposition_ctx
set release_tx = public.release_withdrawal_hold(
  release_withdrawal_id, admin_id, '송금 전 예약을 취소한다',
  'disposition-mine-release-key', 'CANCELLED');
select is(
  public.release_withdrawal_hold(
    (select release_withdrawal_id from disposition_ctx),
    (select admin_id from disposition_ctx),
    '송금 전 예약을 취소한다',
    'disposition-mine-release-key',
    'CANCELLED'
  ),
  (select release_tx from disposition_ctx),
  'release retry returns the original reversal'
);
reset role;

select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id = (select mining_id from disposition_ctx)
      and movement.movement_kind = 'RELEASE'
      and movement.source_bucket = 'MINING_REWARD'
      and movement.origin_code = 'MINING_REWARD_WITHDRAWAL_RELEASE'
      and movement.amount_atomic = 2000
      and movement.ledger_transaction_id = (select release_tx from disposition_ctx)),
  1,
  'release before external send adds one mining reward source row'
);
select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    join public.withdrawal_requests as request
      on request.hold_ledger_transaction_id = (
        select hold.hold_ledger_transaction_id
        from public.withdrawal_requests as hold
        where hold.id = (select release_withdrawal_id from disposition_ctx)
      )
    where movement.user_id = (select mining_id from disposition_ctx)
      and movement.movement_kind = 'FINALIZE'
      and movement.ledger_transaction_id = request.finalize_ledger_transaction_id),
  0,
  'the released hold does not also keep a finalize source row'
);
select is(
  (select count(*)::integer
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = 'disposition-mine-release-key:release'),
  1,
  'release retry does not post a second reversal'
);
select is(
  (select count(*)::integer
    from public.wallet_ledger as ledger
    where ledger.user_id = (select mining_id from disposition_ctx)
      and ledger.direction = 'DEBIT'),
  1,
  'release does not debit the wallet'
);
select is(
  app_private.verified_mining_reward_remaining_atomic(
    (select mining_id from disposition_ctx)),
  2000::bigint,
  'release restores only the cancelled mining reward reservation'
);

set local role service_role;
update disposition_ctx
set replay_withdrawal_id = public.request_krw_withdrawal(
  mining_id, mining_bank_id, 2000, 'disposition-mine-replay-0003');
reset role;
select is(
  (select status from public.withdrawal_requests
    where id = (select replay_withdrawal_id from disposition_ctx)),
  'HELD',
  'the released mining reward can be reserved again'
);
select is(
  (select reservation.credit_movement_id
    from public.mining_reward_withdrawal_reservations as reservation
    where reservation.hold_ledger_transaction_id = (
      select hold_ledger_transaction_id from public.withdrawal_requests
      where id = (select replay_withdrawal_id from disposition_ctx))
      and reservation.ordinal = 0),
  (select older_movement_id from disposition_ctx),
  'the restored remainder still follows newest-first inside mining reward'
);
select is(
  (select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
    from public.funding_principal_recovery_allocations as allocation
    where allocation.user_id = (select mining_id from disposition_ctx)),
  0::bigint,
  'mining reward disposition does not reserve principal'
);

update disposition_ctx
set journal_count = (select count(*)::integer from public.ledger_transactions);
select is(
  app_private.verified_mining_reward_remaining_atomic(
    (select mining_id from disposition_ctx)),
  0::bigint,
  'reading the remaining reward does not change the reserved amount'
);
select is(
  (select count(*)::integer from public.ledger_transactions),
  (select journal_count from disposition_ctx),
  'the remaining reward read does not write a ledger journal'
);

set local role service_role;
select public.approve_deposit_request(
  public.create_deposit_request(principal_id, 'KRW', 8000, 'disposition-principal-deposit'),
  admin_id, 8000, 'disposition-principal-credit', 'verified principal for disposition',
  gen_random_uuid()
) from disposition_ctx;
select lives_ok(
  $$set constraints deposit_requests_money_source_complete immediate$$,
  'principal credit finishes its original receipt'
);
set constraints deposit_requests_money_source_complete deferred;
update disposition_ctx
set principal_finalize_withdrawal_id = public.request_krw_withdrawal(
  principal_id, principal_bank_id, 3000, 'disposition-principal-finalize-0004');
select public.record_krw_external_send(
  principal_finalize_withdrawal_id, 'DISP-PRIN-3000', 3000, admin_id,
  statement_timestamp(), 'disposition-principal-send-0004'
) from disposition_ctx;
update disposition_ctx
set principal_finalize_tx = public.finalize_withdrawal_ledger(
  principal_finalize_withdrawal_id, admin_id, 'disposition-principal-finalize-key');
select is(
  public.finalize_withdrawal_ledger(
    (select principal_finalize_withdrawal_id from disposition_ctx),
    (select admin_id from disposition_ctx),
    'disposition-principal-finalize-key'
  ),
  (select principal_finalize_tx from disposition_ctx),
  'principal finalize retry returns the original journal'
);
reset role;

select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id = (select principal_id from disposition_ctx)
      and movement.movement_kind = 'FINALIZE'
      and movement.source_bucket = 'OTHER_NON_PRINCIPAL'
      and movement.origin_code = 'PRINCIPAL_RECOVERY_FINALIZE'
      and movement.amount_atomic = 3000
      and movement.ledger_transaction_id = (select principal_finalize_tx from disposition_ctx)),
  1,
  'principal finalize adds one source row matching the reserved hold'
);
select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id = (select principal_id from disposition_ctx)
      and movement.movement_kind = 'RESERVE'
      and movement.origin_code = 'PRINCIPAL_RECOVERY_HOLD'
      and movement.amount_atomic = 3000),
  1,
  'principal finalize does not rewrite the original reserve row'
);
select is(
  (select count(*)::integer
    from public.ledger_entries as entry
    where entry.transaction_id = (select principal_finalize_tx from disposition_ctx)),
  2,
  'principal finalize source row does not add another ledger entry'
);
select is(
  (select count(*)::integer
    from public.wallet_ledger as ledger
    where ledger.user_id = (select principal_id from disposition_ctx)
      and ledger.direction = 'DEBIT'),
  1,
  'principal finalize debits the wallet only once'
);
select is(
  app_private.funding_principal_mining_eligible_micro(
    (select principal_id from disposition_ctx), statement_timestamp()),
  app_private.funding_principal_micro_krw(5000),
  'finalized principal stays reserved'
);

set local role service_role;
update disposition_ctx
set principal_release_withdrawal_id = public.request_krw_withdrawal(
  principal_id, principal_bank_id, 2000, 'disposition-principal-release-0005');
update disposition_ctx
set principal_release_tx = public.release_withdrawal_hold(
  principal_release_withdrawal_id, admin_id, '원금 예약을 송금 전에 취소한다',
  'disposition-principal-release-key', 'CANCELLED');
select is(
  public.release_withdrawal_hold(
    (select principal_release_withdrawal_id from disposition_ctx),
    (select admin_id from disposition_ctx),
    '원금 예약을 송금 전에 취소한다',
    'disposition-principal-release-key',
    'CANCELLED'
  ),
  (select principal_release_tx from disposition_ctx),
  'principal release retry returns the original reversal'
);
reset role;

select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id = (select principal_id from disposition_ctx)
      and movement.movement_kind = 'RELEASE'
      and movement.origin_code = 'PRINCIPAL_RECOVERY_RELEASE'
      and movement.amount_atomic = 2000
      and movement.ledger_transaction_id = (select principal_release_tx from disposition_ctx)),
  1,
  'principal release reuses one release source row'
);
select is(
  (select count(*)::integer
    from public.funding_principal_recovery_releases as recovery_release
    where recovery_release.release_ledger_transaction_id =
      (select principal_release_tx from disposition_ctx)),
  1,
  'principal release restores the reservation once'
);
select is(
  app_private.funding_principal_mining_eligible_micro(
    (select principal_id from disposition_ctx), statement_timestamp()),
  app_private.funding_principal_micro_krw(5000),
  'released principal returns and the finalized principal stays reserved'
);
select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id = (select principal_id from disposition_ctx)
      and movement.source_bucket = 'MINING_REWARD'),
  0,
  'principal disposition does not create a mining reward source'
);
select is(
  (select count(*)::integer
    from public.money_source_movements as movement
    where movement.user_id in (
      (select mining_id from disposition_ctx),
      (select principal_id from disposition_ctx)
    )
      and movement.source_bucket = 'BONUS'),
  0,
  'bonus is not a general withdrawal source on these holds'
);
select ok(
  not exists (
    select 1
    from public.withdrawal_requests as request
    where request.user_id in (
      (select mining_id from disposition_ctx),
      (select principal_id from disposition_ctx)
    )
      and exists (
        select 1
        from public.money_source_movements as finalized
        where finalized.ledger_transaction_id = request.finalize_ledger_transaction_id
          and finalized.movement_kind = 'FINALIZE'
      )
      and exists (
        select 1
        from public.money_source_movements as released
        where released.ledger_transaction_id = request.release_ledger_transaction_id
          and released.movement_kind = 'RELEASE'
      )
  ),
  'one hold does not keep both finalize and release source rows'
);

insert into public.withdrawal_policies(
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select 'KRW', 'KRW_BANK', 1063102, true, 1, 50, '{}'::jsonb,
  statement_timestamp() - interval '1 hour', admin_id, false
from disposition_ctx;
set local role service_role;
select throws_ok(
  $$select public.request_krw_withdrawal(fee_id, fee_bank_id, 1000, 'disposition-fee-0006')
    from disposition_ctx$$,
  '55000', 'WITHDRAWAL_SOURCE_INSUFFICIENT',
  'a non-zero fee still does not open a reserved hold'
);
reset role;
select is(
  (select count(*)::integer from public.withdrawal_requests
    where user_id = (select fee_id from disposition_ctx)),
  0,
  'the rejected fee request leaves no hold'
);
select is(
  (select count(*)::integer from public.mining_settlements
    where user_id in (
      (select mining_id from disposition_ctx),
      (select principal_id from disposition_ctx),
      (select fee_id from disposition_ctx)
    )),
  0,
  'disposition does not reactivate mining settlement'
);

select * from finish();
rollback;
