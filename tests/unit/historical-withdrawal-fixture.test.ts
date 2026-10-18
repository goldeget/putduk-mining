import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("../e2e/authenticated/helpers/local-db", () => ({
  execLocalAdminSql: mocks.sql,
}));
import {
  readWithdrawalMoneySnapshot,
  seedHistoricalHeldWithdrawal,
} from "../e2e/authenticated/helpers/historical-withdrawal-fixture";

const ownerId = "11111111-1111-4111-8111-111111111111";
const destinationId = "22222222-2222-4222-8222-222222222222";
const withdrawalId = "33333333-3333-4333-8333-333333333333";
const input = {
  ownerId,
  destinationId,
  amountKrw: "1000",
  key: "historical-key",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sql.mockReturnValue(withdrawalId);
});

describe("historical owner fixture boundary", () => {
  it("defines and calls pg_temp in one transaction with SQL-quoted variables", () => {
    const key = "historical-key'; select pg_sleep(100); --";
    expect(seedHistoricalHeldWithdrawal({ ...input, key })).toBe(withdrawalId);
    expect(mocks.sql).toHaveBeenCalledOnce();
    const [sql, variables] = mocks.sql.mock.calls[0]!;
    expect(sql).toMatch(/^\\set QUIET on\nbegin;/);
    expect(sql).toContain(
      "create function pg_temp.seed_historical_held_withdrawal",
    );
    expect(sql).toContain("current_user <> 'postgres'");
    expect(sql).toContain("app_private.post_withdrawal_hold(");
    expect(sql).toContain(
      ":'owner'::uuid, :'destination'::uuid, :'amount'::bigint, :'key'",
    );
    expect(sql).toMatch(/commit;$/);
    expect(sql).not.toContain(key);
    expect(sql).not.toMatch(
      /insert into public\.(wallet_ledger|money_source_movements)/,
    );
    expect(variables).toEqual({
      owner: ownerId,
      destination: destinationId,
      amount: "1000",
      key,
    });
  });
  it("binds and reads back only the exact existing owner/key/method/destination/amount in the same transaction", () => {
    seedHistoricalHeldWithdrawal(input);
    const sql = mocks.sql.mock.calls[0]![0] as string;
    expect(sql).toContain(
      "create function pg_temp.seed_bound_historical_held_withdrawal",
    );
    expect(sql.indexOf("putduk-funding-recovery:")).toBeLessThan(
      sql.indexOf("withdrawal-logical:"),
    );
    expect(sql).toContain(
      "where user_id = p_owner and idempotency_key = p_key for update",
    );
    expect(sql).toContain(
      "v_logical.destination_id is distinct from p_destination",
    );
    expect(sql).toContain("v_logical.amount_krw is distinct from p_amount");
    expect(sql).toContain(
      "v_request.destination_type is distinct from v_logical.method",
    );
    expect(sql).toContain(
      "v_request.withdrawal_destination_id is distinct from p_destination",
    );
    expect(sql).toContain("v_logical.withdrawal_id is not null");
    expect(sql).toContain("HISTORICAL_FIXTURE_LOGICAL_BINDING_REQUIRED");
    expect(sql).toContain(
      "and l.amount_krw = p_amount and l.withdrawal_id = v_id",
    );
    expect(sql).toContain("HISTORICAL_FIXTURE_LOGICAL_READBACK_REQUIRED");
    expect(sql).not.toContain("insert into public.withdrawal_logical_requests");
    expect(sql.match(/begin;/g)).toHaveLength(1);
    expect(sql.match(/commit;/g)).toHaveLength(1);
  });
  it.each([
    { ownerId: "not-owner" },
    { destinationId: "not-destination" },
    { amountKrw: "0" },
    { amountKrw: "-1" },
    { amountKrw: "1.5" },
    { amountKrw: "1e3" },
    { amountKrw: "9223372036854775808" },
    { key: "short" },
    { key: "a".repeat(201) },
    { key: "historical\nkey" },
    { key: " historical-key" },
    { key: "historical\0key" },
  ])("rejects invalid fixture inputs before any SQL %j", (extra) => {
    expect(() => seedHistoricalHeldWithdrawal({ ...input, ...extra })).toThrow(
      /INVALID/,
    );
    expect(mocks.sql).not.toHaveBeenCalled();
  });
  it("preserves a bigint above the JavaScript exact integer limit", () => {
    seedHistoricalHeldWithdrawal({
      ...input,
      amountKrw: "9223372036854775807",
    });
    expect(mocks.sql.mock.calls[0]![1].amount).toBe("9223372036854775807");
  });
  it("rejects a missing, extra or malformed receipt instead of claiming recovery", () => {
    for (const result of [
      "",
      "BEGIN",
      `${withdrawalId}\n${withdrawalId}`,
      "not-uuid",
    ]) {
      mocks.sql.mockReturnValue(result);
      expect(() => seedHistoricalHeldWithdrawal(input)).toThrow(
        "HISTORICAL_FIXTURE_RESULT_INVALID",
      );
    }
  });
  it("records exact balance/count strings and refuses an invalid snapshot owner", () => {
    mocks.sql.mockReturnValue(
      '{"requests":"1","availableKrw":"9223372036854775807"}',
    );
    expect(readWithdrawalMoneySnapshot(ownerId)).toEqual({
      requests: "1",
      availableKrw: "9223372036854775807",
    });
    expect(mocks.sql.mock.calls[0]![1]).toEqual({ owner: ownerId });
    expect(() => readWithdrawalMoneySnapshot("invalid")).toThrow(
      "HISTORICAL_FIXTURE_OWNER_INVALID",
    );
    expect(mocks.sql).toHaveBeenCalledOnce();
  });
});
