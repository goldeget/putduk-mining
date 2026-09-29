import { randomUUID } from "node:crypto";

import type { UsdtDepositNetwork } from "@/domain/wallet/usdt-manual-deposit";

import { execLocalAdminSql } from "./local-db";

/**
 * 브라우저 입금 증거는 로컬 데이터베이스 admin 연결로만 만든다.
 * 운영 마이그레이션, service_role GRANT, test RPC 는 추가하지 않는다.
 *
 * USDT 확인 금액 1000은 화면 증거용 고정값이다.
 * 운영 환율이나 변환 규칙이 아니다.
 */
export const FIXTURE_USDT_CONFIRM_KRW = 1000;

export const FIXTURE_TRC20_ADDRESS = "TLOCALDEPOSITFIXTURETRC200000000001";
export const FIXTURE_ERC20_ADDRESS = "0xLOCALDEPOSITFIXTUREERC20000000001";
export const FIXTURE_LONG_TRC20_ADDRESS = `T${"LOCALDEPOSIT".repeat(5)}00000001`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(label);
  }
}

function assertFixtureAddress(value: string) {
  if (!/^[A-Za-z0-9]+$/.test(value) || value.length < 8 || value.length > 128) {
    throw new Error("DEPOSIT_FIXTURE_ADDRESS");
  }
}

function assertNetwork(value: string): asserts value is UsdtDepositNetwork {
  if (value !== "TRC20" && value !== "ERC20" && value !== "BEP20") {
    throw new Error("DEPOSIT_FIXTURE_NETWORK");
  }
}

export function ensureLocalAdmin(userId: string) {
  assertUuid(userId, "DEPOSIT_FIXTURE_ADMIN");
  execLocalAdminSql(
    `insert into public.user_roles (user_id, role, granted_by)
     select :'user_id'::uuid, 'ADMIN', :'user_id'::uuid
     where not exists (
       select 1
       from public.user_roles as role
       where role.user_id = :'user_id'::uuid
         and role.role = 'ADMIN'
         and role.revoked_at is null
     )`,
    { user_id: userId },
  );
}

function snapshotActiveInstructionIds() {
  const raw = execLocalAdminSql(
    `select coalesce(string_agg(id::text, ',' order by id::text), '')
     from public.usdt_deposit_instructions
     where is_active`,
  );
  if (!raw) {
    return [];
  }
  const ids = raw.split(",");
  for (const id of ids) {
    assertUuid(id, "DEPOSIT_FIXTURE_SNAPSHOT");
  }
  return ids;
}

function deactivateActiveInstructions() {
  execLocalAdminSql(
    `update public.usdt_deposit_instructions
     set is_active = false,
         deactivated_at = statement_timestamp()
     where is_active`,
  );
}

function restoreActiveInstructions(ids: readonly string[]) {
  deactivateActiveInstructions();
  for (const id of ids) {
    execLocalAdminSql(
      `update public.usdt_deposit_instructions
       set is_active = true,
           deactivated_at = null
       where id = :'instruction_id'::uuid`,
      { instruction_id: id },
    );
  }
}

function activateInstruction(
  actorId: string,
  input: { address: string; network: UsdtDepositNetwork },
) {
  assertNetwork(input.network);
  assertFixtureAddress(input.address);
  execLocalAdminSql(
    `select public.set_usdt_deposit_instructions(
       :'address',
       :'network',
       :'actor_id'::uuid,
       :'reason',
       :'request_id'::uuid
     )`,
    {
      actor_id: actorId,
      address: input.address,
      network: input.network,
      reason: "로컬 입금 안내 증거",
      request_id: randomUUID(),
    },
  );
}

export async function withActiveUsdtInstructions(
  actorId: string,
  instructions: readonly { address: string; network: UsdtDepositNetwork }[],
  run: () => Promise<void>,
) {
  ensureLocalAdmin(actorId);
  const snapshot = snapshotActiveInstructionIds();
  try {
    deactivateActiveInstructions();
    for (const item of instructions) {
      activateInstruction(actorId, item);
    }
    await run();
  } finally {
    restoreActiveInstructions(snapshot);
  }
}

export function seedKrwDepositStatuses(input: {
  operatorId: string;
  userId: string;
}) {
  assertUuid(input.operatorId, "DEPOSIT_FIXTURE_OPERATOR");
  assertUuid(input.userId, "DEPOSIT_FIXTURE_MEMBER");
  ensureLocalAdmin(input.operatorId);
  const output = execLocalAdminSql(
    `create temp table deposit_fixture_ids (
       label text primary key,
       id uuid not null
     );

     insert into deposit_fixture_ids (label, id)
     values
       ('requested', public.create_deposit_request(:'user_id'::uuid, 'KRW', 11000, :'key_requested')),
       ('awaiting', public.create_deposit_request(:'user_id'::uuid, 'KRW', 12000, :'key_awaiting')),
       ('reviewing', public.create_deposit_request(:'user_id'::uuid, 'KRW', 13000, :'key_reviewing')),
       ('approved', public.create_deposit_request(:'user_id'::uuid, 'KRW', 14000, :'key_approved')),
       ('rejected', public.create_deposit_request(:'user_id'::uuid, 'KRW', 15000, :'key_rejected')),
       ('cancelled', public.create_deposit_request(:'user_id'::uuid, 'KRW', 16000, :'key_cancelled'));

     update public.deposit_requests
     set status = 'REQUESTED'
     where id = (select id from deposit_fixture_ids where label = 'requested')
       and user_id = :'user_id'::uuid
       and status = 'AWAITING_TRANSFER';

     update public.deposit_requests
     set status = 'REVIEWING'
     where id = (select id from deposit_fixture_ids where label = 'reviewing')
       and user_id = :'user_id'::uuid
       and status = 'AWAITING_TRANSFER';

     update public.deposit_requests
     set
       status = 'REJECTED',
       rejection_reason = '로컬 화면 증거',
       reviewed_by = :'operator_id'::uuid,
       reviewed_at = statement_timestamp()
     where id = (select id from deposit_fixture_ids where label = 'rejected')
       and user_id = :'user_id'::uuid
       and status = 'AWAITING_TRANSFER';

     update public.deposit_requests
     set status = 'CANCELLED'
     where id = (select id from deposit_fixture_ids where label = 'cancelled')
       and user_id = :'user_id'::uuid
       and status = 'AWAITING_TRANSFER';

     select public.approve_deposit_request(
       (select id from deposit_fixture_ids where label = 'approved'),
       :'operator_id'::uuid,
       14000,
       :'ledger_key',
       :'approve_reason',
       :'approve_request_id'::uuid
     );

     select count(*)
     from public.deposit_requests
     where user_id = :'user_id'::uuid
       and status::text in (
         'REQUESTED',
         'AWAITING_TRANSFER',
         'REVIEWING',
         'APPROVED',
         'REJECTED',
         'CANCELLED'
       )`,
    {
      approve_reason: "로컬 원화 입금 승인 증거",
      approve_request_id: randomUUID(),
      key_approved: `e2e-krw-approved-${input.userId}`,
      key_awaiting: `e2e-krw-awaiting-${input.userId}`,
      key_cancelled: `e2e-krw-cancelled-${input.userId}`,
      key_rejected: `e2e-krw-rejected-${input.userId}`,
      key_requested: `e2e-krw-requested-${input.userId}`,
      key_reviewing: `e2e-krw-reviewing-${input.userId}`,
      ledger_key: `e2e-krw-ledger-${input.userId}`,
      operator_id: input.operatorId,
      user_id: input.userId,
    },
  );
  const count = output.split(/\r?\n/).filter(Boolean).at(-1);
  if (count !== "6") {
    throw new Error(`KRW_STATUS_MATRIX:${count ?? "empty"}`);
  }
}

export function confirmLocalUsdtDeposit(input: {
  actorId: string;
  depositId: string;
}) {
  assertUuid(input.actorId, "DEPOSIT_FIXTURE_ACTOR");
  assertUuid(input.depositId, "DEPOSIT_FIXTURE_DEPOSIT");
  ensureLocalAdmin(input.actorId);
  execLocalAdminSql(
    `select public.confirm_usdt_manual_deposit(
       :'deposit_id'::uuid,
       :credited_krw,
       :'actor_id'::uuid,
       :'reason',
       :'idempotency_key'
     )`,
    {
      actor_id: input.actorId,
      credited_krw: String(FIXTURE_USDT_CONFIRM_KRW),
      deposit_id: input.depositId,
      idempotency_key: `e2e-usdt-confirm-${input.depositId}`,
      reason: "로컬 증거용 KRW 반영이며 운영 환율이 아닙니다",
    },
  );
}

export function readLocalUsdtDepositId(input: {
  network: UsdtDepositNetwork;
  txHash: string;
  userId: string;
}) {
  assertUuid(input.userId, "DEPOSIT_FIXTURE_MEMBER");
  assertNetwork(input.network);
  const txHash = input.txHash.trim().toLowerCase();
  if (!/^[a-z0-9]+$/.test(txHash) || txHash.length < 8 || txHash.length > 128) {
    throw new Error("DEPOSIT_FIXTURE_TX");
  }
  const id = execLocalAdminSql(
    `select id::text
     from public.usdt_manual_deposits
     where user_id = :'user_id'::uuid
       and network = :'network'
       and tx_hash = :'tx_hash'`,
    {
      network: input.network,
      tx_hash: txHash,
      user_id: input.userId,
    },
  );
  assertUuid(id, "DEPOSIT_FIXTURE_DEPOSIT_READ");
  return id;
}
