import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  buildApi195HeldFixture,
  USDT_195_FROZEN_SOURCES,
} from "../../../scripts/usdt-manual-195-native-fixture-v3.mjs";
import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import {
  authenticateBackend195Operator,
  requireBackend195Target,
  unauthenticatedBackend195Command,
} from "./helpers/backend-http-197-auth";
import { execLocalAdminSql } from "./helpers/local-db";
import { manual195Evidence } from "./helpers/usdt-manual-195-fixture";

// Backend HTTP only: no page rendering, UI mutation, transfer, FX quote or provider call.
// All rows are fresh synthetic fixture rows; native principal assertions run separately.
test("197 real Auth/step-up → strict manual USDT receipt → ledger and exact replay", async () => {
  const reviewed = requireBackend195Target();
  const versions = reviewed.migrationVersions
    .map((version) => "'" + version + "'")
    .join(",");
  expect(
    execLocalAdminSql(
      "select array_agg(version order by version)=array[" +
        versions +
        "]::text[] from supabase_migrations.schema_migrations;",
    ),
  ).toBe("t");
  const anonymous = await unauthenticatedBackend195Command({});
  expect(anonymous.status).toBe(401);
  expect(anonymous.data?.code).toBe("UNAUTHENTICATED");
  const service = createLocalServiceRoleClient();
  const owner = await createConfirmedMember("manual195owner");
  const operator = await createConfirmedMember("manual195operator");
  const role = await service.from("user_roles").insert({
    user_id: operator.userId,
    role: "ADMIN",
    granted_by: operator.userId,
  });
  if (role.error) throw new Error("SYNTHETIC_195_OPERATOR_ROLE_SETUP_FAILED");
  const auth = await authenticateBackend195Operator({
    email: operator.email,
    password: operator.password,
  });
  const original = await readFile(USDT_195_FROZEN_SOURCES.krw.path);
  const destinationId = randomUUID();
  const prepared = execLocalAdminSql(
    buildApi195HeldFixture(original, {
      fullPayoutConfirmed: true,
      memberId: owner.userId,
      adminId: operator.userId,
      destinationId,
      movementId: randomUUID(),
    }),
  );
  const ids = prepared
    .split(/\r?\n/)
    .filter((line) =>
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(line.trim()),
    );
  expect(ids).toHaveLength(1);
  const withdrawalId = ids[0]!.trim();
  const request = await service
    .from("withdrawal_requests")
    .select(
      "id,user_id,amount_atomic,fee_atomic,status,withdrawal_destination_id",
    )
    .eq("id", withdrawalId)
    .single();
  if (request.error)
    throw new Error("SYNTHETIC_195_ORIGINAL_REQUEST_READ_FAILED");
  expect(request.data).toMatchObject({
    id: withdrawalId,
    user_id: owner.userId,
    status: "HELD",
    withdrawal_destination_id: destinationId,
  });
  expect(String(request.data.amount_atomic)).toBe("5000");
  expect(String(request.data.fee_atomic)).toBe("0");
  const evidence = manual195Evidence({
    withdrawalId,
    requestedKrwAmount: String(request.data.amount_atomic),
    actualUsdtAmount: "1.25",
    network: "TRC20",
    fullPayoutConfirmed: true,
  });
  const base = {
    action: "RECORD_USDT_SEND",
    withdrawalId,
    network: "TRC20",
    txHash: "synthetic195-" + randomUUID(),
    actualUsdtAmount: "1.25",
    sentAt: new Date().toISOString(),
    conversionEvidence: evidence,
    idempotencyKey: "195-send-" + randomUUID(),
  };
  const missingStep = await auth.post("/api/v1/admin/withdrawals/command", {
    ...base,
    stepUpToken: "invalid-step-up-proof",
  });
  expect(missingStep.status).toBe(403);
  expect(missingStep.data?.code).toBe("STEP_UP_REQUIRED");
  const foreign = await auth.post(
    "/api/v1/admin/withdrawals/command",
    { ...base, stepUpToken: "invalid-step-up-proof" },
    "https://invalid.example",
  );
  expect(foreign.status).toBe(403);
  expect(foreign.data?.code).toBe("ORIGIN_DENIED");
  const invalid = [
    {
      name: "NULL",
      value: null,
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_REQUIRED",
    },
    {
      name: "legacy",
      value: { local: "synthetic" },
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
    },
    {
      name: "unconfirmed",
      value: { ...evidence, fullPayoutConfirmed: false },
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
    },
    {
      name: "fee",
      value: { ...evidence, feeKrw: "1" },
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
    },
    {
      name: "different-original",
      value: { ...evidence, withdrawalId: randomUUID() },
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
    },
    {
      name: "different-request",
      value: { ...evidence, requestedKrwAmount: "5001" },
      code: "USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH",
    },
    {
      name: "one-micro",
      value: { ...evidence, actualUsdtAmount: "1.250001" },
      code: "USDT_MANUAL_FULL_PAYOUT_AMOUNT_MISMATCH",
    },
    {
      name: "noncanonical",
      value: { ...evidence, actualUsdtAmount: "1.250000" },
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
    },
    {
      name: "extra-owner",
      value: { ...evidence, owner: owner.userId },
      code: "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
    },
  ];
  for (const scenario of invalid) {
    const denied = await auth.command({
      ...base,
      conversionEvidence: scenario.value,
      idempotencyKey: "195-negative-" + randomUUID(),
    });
    expect(denied.status, scenario.name).toBe(409);
    expect(denied.data?.code, scenario.name).toBe(scenario.code);
  }
  const precision = await auth.command({
    ...base,
    actualUsdtAmount: "1.2500001",
    idempotencyKey: "195-precision-" + randomUUID(),
  });
  expect(precision.status).toBe(400);
  expect(precision.data?.code).toBe("INVALID_COMMAND");
  const network = await auth.command({
    ...base,
    network: "ERC20",
    conversionEvidence: { ...evidence, network: "ERC20" },
    idempotencyKey: "195-network-" + randomUUID(),
  });
  expect(network.status).toBe(409);
  expect(network.data?.code).toBe("USDT_SEND_NETWORK_MISMATCH");
  const pending = await service
    .from("withdrawal_requests")
    .select("status")
    .eq("id", withdrawalId)
    .single();
  const absent = await service
    .from("withdrawal_external_sends")
    .select("id")
    .eq("withdrawal_id", withdrawalId);
  if (pending.error || absent.error)
    throw new Error("NEGATIVE_195_READBACK_FAILED");
  expect(pending.data.status).toBe("HELD");
  expect(absent.data).toHaveLength(0);
  const token = await auth.stepUp();
  const first = await auth.post("/api/v1/admin/withdrawals/command", {
    ...base,
    stepUpToken: token,
  });
  expect(first.status).toBe(200);
  expect(first.data?.ok).toBe(true);
  expect(first.data?.sendId).toMatch(/^[0-9a-f-]{36}$/);
  const used = await auth.post("/api/v1/admin/withdrawals/command", {
    ...base,
    stepUpToken: token,
  });
  expect(used.status).toBe(403);
  expect(used.data?.code).toBe("STEP_UP_REQUIRED");
  const repeated = await auth.command(base);
  expect(repeated.status).toBe(200);
  expect(repeated.data?.sendId).toBe(first.data?.sendId);
  const alias = await auth.command({
    ...base,
    idempotencyKey: "195-alias-" + randomUUID(),
  });
  expect(alias.status).toBe(200);
  expect(alias.data?.sendId).toBe(first.data?.sendId);
  const changed = await auth.command({
    ...base,
    actualUsdtAmount: "1.250001",
    conversionEvidence: evidence,
    idempotencyKey: "195-changed-" + randomUUID(),
  });
  expect(changed.status).toBe(409);
  expect(changed.data?.code).toBe("EXTERNAL_SEND_PAYLOAD_MISMATCH");
  const finalizeBody = {
    action: "FINALIZE_LEDGER",
    withdrawalId,
    idempotencyKey: "195-finalize-" + randomUUID(),
  };
  const finalized = await auth.command(finalizeBody);
  expect(finalized.status).toBe(200);
  expect(finalized.data?.ok).toBe(true);
  const finalizeReplay = await auth.command(finalizeBody);
  expect(finalizeReplay.status).toBe(200);
  expect(finalizeReplay.data?.ledgerTransactionId).toBe(
    finalized.data?.ledgerTransactionId,
  );
  const send = await service
    .from("withdrawal_external_sends")
    .select(
      "id,withdrawal_id,actual_usdt_amount,conversion_evidence,network,method",
    )
    .eq("withdrawal_id", withdrawalId);
  if (send.error) throw new Error("SEND_195_READBACK_FAILED");
  expect(send.data).toHaveLength(1);
  expect(send.data[0]).toMatchObject({
    id: first.data?.sendId,
    withdrawal_id: withdrawalId,
    conversion_evidence: evidence,
    network: "TRC20",
    method: "USDT_ADDRESS",
  });
  expect(String(send.data[0]!.actual_usdt_amount)).toMatch(
    /^1\.25(?:0{1,4})?$/,
  );
  const complete = await service
    .from("withdrawal_requests")
    .select(
      "status,currency,amount_atomic,fee_atomic,finalize_ledger_transaction_id",
    )
    .eq("id", withdrawalId)
    .single();
  if (complete.error) throw new Error("FINALIZED_195_READBACK_FAILED");
  expect(complete.data.status).toBe("COMPLETED");
  expect(complete.data.currency).toBe("KRW");
  expect(String(complete.data.amount_atomic)).toBe("5000");
  expect(String(complete.data.fee_atomic)).toBe("0");
  expect(complete.data.finalize_ledger_transaction_id).toBe(
    finalized.data?.ledgerTransactionId,
  );
  const entries = await service
    .from("ledger_entries")
    .select("side,amount_atomic")
    .eq("transaction_id", String(finalized.data?.ledgerTransactionId));
  if (entries.error) throw new Error("JOURNAL_195_READBACK_FAILED");
  expect(entries.data).toHaveLength(2);
  expect(entries.data.filter((row) => row.side === "DEBIT")).toHaveLength(1);
  expect(entries.data.filter((row) => row.side === "CREDIT")).toHaveLength(1);
  for (const row of entries.data)
    expect(String(row.amount_atomic)).toBe("5000");
  expect(
    entries.data.reduce(
      (sum, row) =>
        sum +
        (row.side === "DEBIT" ? 1n : -1n) * BigInt(String(row.amount_atomic)),
      0n,
    ),
  ).toBe(0n);
  const header = await service
    .from("ledger_transactions")
    .select("id,currency,category,reference_type,reference_id,member_user_id")
    .eq("id", String(finalized.data?.ledgerTransactionId))
    .single();
  if (header.error) throw new Error("JOURNAL_HEADER_195_READBACK_FAILED");
  expect(header.data).toMatchObject({
    id: finalized.data?.ledgerTransactionId,
    currency: "KRW",
    category: "WITHDRAWAL",
    reference_type: "withdrawal_request",
    reference_id: withdrawalId,
    member_user_id: owner.userId,
  });
  const debits = await service
    .from("wallet_ledger")
    .select("id,direction,entry_type,amount_atomic")
    .eq("reference_type", "withdrawal_request")
    .eq("reference_id", withdrawalId)
    .eq("user_id", owner.userId);
  if (debits.error) throw new Error("WALLET_DEBIT_195_READBACK_FAILED");
  expect(debits.data).toHaveLength(1);
  expect(debits.data[0]).toMatchObject({
    direction: "DEBIT",
    entry_type: "WITHDRAWAL",
  });
  expect(String(debits.data[0]!.amount_atomic)).toBe("5000");
  const cryptoWallets = await service
    .from("wallet_accounts")
    .select("id")
    .eq("user_id", owner.userId)
    .eq("currency", "USDT");
  if (cryptoWallets.error) throw new Error("USDT_195_BALANCE_READBACK_FAILED");
  expect(cryptoWallets.data).toHaveLength(0);
});
