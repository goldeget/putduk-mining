import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ display: vi.fn(), adminFrom: vi.fn() }));
vi.mock("@/lib/product/read-mining-server-display", () => ({
  readOwnMiningServerDisplay: mocks.display,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.adminFrom }),
}));
import { emptyMiningServerDisplay } from "@/lib/product/mining-server-display";
import { readPrincipalWithdrawal } from "@/lib/wallet/read-principal-withdrawal.server";
import type { VerifiedIdentity } from "@/lib/auth/session";
const owner = "11111111-1111-4111-8111-111111111111",
  dest = "33333333-3333-4333-8333-333333333333",
  policy = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-06T00:00:00.123456Z";
type ReadResult = { data: unknown; error: unknown };
type RequiredReadTable =
  | "money_source_summaries"
  | "wallet_balance_snapshots"
  | "withdrawal_policies"
  | "withdrawal_destinations"
  | "safe_mode_controls";
const rows: Record<string, ReadResult> & Record<RequiredReadTable, ReadResult> =
  {
    money_source_summaries: { data: null, error: null },
    wallet_balance_snapshots: { data: null, error: null },
    withdrawal_policies: { data: null, error: null },
    withdrawal_destinations: { data: null, error: null },
    safe_mode_controls: { data: null, error: null },
  };
const queries: Record<string, ReturnType<typeof vi.fn>[]> = {};
function query(name: string) {
  const q: Record<string, unknown> = {};
  queries[name] = [];
  for (const method of [
    "select",
    "eq",
    "is",
    "in",
    "lte",
    "or",
    "order",
    "limit",
  ]) {
    const f = vi.fn().mockReturnValue(q);
    q[method] = f;
    queries[name]!.push(f);
  }
  q.maybeSingle = vi.fn(async () => rows[name]);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows[name]).then(resolve);
  return q;
}
function display(extra: Record<string, unknown> = {}) {
  return {
    ...emptyMiningServerDisplay,
    available: true,
    eligible_principal_micro_krw: "100000000000",
    funded_runtime: {
      schema_version: 2,
      runtime_version: 2,
      state_revision: "5",
      condition_revision: "3",
      accepted_cursor_at: at,
      evaluated_at: at,
      allocation_bps: "2500",
      committed_reward_total_atomic: "100",
      reward_carry: { numerator: "1", denominator: "4", unit: "KRW" },
      conditional_maintenance: {
        numerator: "200",
        denominator: "1",
        unit: "KRW",
        qualification: "UNCONFIRMED",
      },
      status: "ACTIVE",
      stop_reason: null,
      speed: {
        product_multiplier_bps: "10000",
        user_multiplier_bps: "10000",
        common_multiplier: { numerator: "1", denominator: "1" },
        effective_global_multiplier: { numerator: "1", denominator: "4" },
      },
    },
    ...extra,
  };
}
const identity = {
  userId: owner,
  supabase: { from: (name: string) => query(name) },
} as unknown as VerifiedIdentity;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WITHDRAWAL_DATA_KEY", "test-only-config-presence");
  mocks.display.mockResolvedValue({ data: display(), error: null });
  mocks.adminFrom.mockImplementation(query);
  rows.money_source_summaries = {
    data: {
      schema_version: 2,
      coverage: "COMPLETE",
      eligible_principal_atomic: "100000",
      held_principal_atomic: "30000",
    },
    error: null,
  };
  rows.wallet_balance_snapshots = {
    data: { available_balance_atomic: "95000" },
    error: null,
  };
  rows.withdrawal_policies = {
    data: {
      id: policy,
      version: 1,
      minimum_amount_atomic: "1000",
      fee_atomic: "0",
      destination_config: { allowed_bank_codes: ["KB"] },
    },
    error: null,
  };
  rows.withdrawal_destinations = {
    data: [
      {
        id: dest,
        display_hint: "KB ****1234",
        verification_status: "VERIFIED",
        protection_until: at,
      },
    ],
    error: null,
  };
  rows.safe_mode_controls = {
    data: [
      { is_paused: false, starts_at: at },
      { is_paused: false, starts_at: at },
    ],
    error: null,
  };
});
afterEach(() => vi.unstubAllEnvs());
describe("bounded existing server read for principal UI", () => {
  it("uses strict current runtime proof and separates wallet from principal", async () => {
    const result = await readPrincipalWithdrawal(identity);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("expected safe read");
    expect(result.eligiblePrincipalKrw).toBe("100000");
    expect(result.walletAvailableKrw).toBe("95000");
    expect(result.heldPrincipalKrw).toBe("30000");
    expect(result.destinations).toEqual([
      { id: dest, displayHint: "KB ****1234" },
    ]);
    expect(mocks.display).toHaveBeenCalledWith(identity);
    expect(mocks.adminFrom.mock.calls.map((c) => c[0])).not.toContain(
      "funding_condition_originals",
    );
    expect(JSON.stringify(result)).not.toContain("conditional_maintenance");
  });
  it("a one-microsecond future protection remains unavailable as a destination", async () => {
    rows.withdrawal_destinations.data = [
      {
        id: dest,
        display_hint: "KB ****1234",
        verification_status: "VERIFIED",
        protection_until: "2026-10-06T00:00:00.123457Z",
      },
    ];
    const result = await readPrincipalWithdrawal(identity);
    expect(result.available && result.destinations).toEqual([]);
  });
  it("older protection in another timezone is compared at the same DB instant", async () => {
    rows.withdrawal_destinations.data = [
      {
        id: dest,
        display_hint: "KB ****1234",
        verification_status: "VERIFIED",
        protection_until: "2026-10-06T09:00:00.123456+09:00",
      },
    ];
    const r = await readPrincipalWithdrawal(identity);
    expect(r.available && r.destinations.length).toBe(1);
  });
  it.each(["UNRESOLVED", null])(
    "unknown source %j produces no financial facts",
    async (coverage) => {
      rows.money_source_summaries.data = {
        schema_version: 2,
        coverage,
        eligible_principal_atomic: "100000",
        held_principal_atomic: "0",
      };
      expect(await readPrincipalWithdrawal(identity)).toEqual({
        schemaVersion: 1,
        available: false,
      });
    },
  );
  it("source/display principal race is unavailable rather than a mixed execution preview", async () => {
    rows.money_source_summaries.data = {
      schema_version: 2,
      coverage: "COMPLETE",
      eligible_principal_atomic: "99999",
      held_principal_atomic: "0",
    };
    expect((await readPrincipalWithdrawal(identity)).available).toBe(false);
  });
  it("highest empty-config policy is unavailable and never replaced with older generic policy", async () => {
    rows.withdrawal_policies.data = {
      id: policy,
      version: 20,
      minimum_amount_atomic: "1",
      fee_atomic: "0",
      destination_config: {},
    };
    expect((await readPrincipalWithdrawal(identity)).available).toBe(false);
    expect(
      mocks.adminFrom.mock.calls.filter((c) => c[0] === "withdrawal_policies"),
    ).toHaveLength(1);
  });
  it("nonzero policy fee is unsupported without fabricating fee fallback", async () => {
    rows.withdrawal_policies.data = {
      id: policy,
      version: 1,
      minimum_amount_atomic: "1",
      fee_atomic: "1",
      destination_config: { allowed_bank_codes: ["KB"] },
    };
    expect((await readPrincipalWithdrawal(identity)).available).toBe(false);
  });
  it("missing current proof never upgrades legacy receipt facts to principal eligibility", async () => {
    const d = display();
    const r = { ...d.funded_runtime, schema_version: 1 };
    delete (r as Partial<typeof r>).status;
    delete (r as Partial<typeof r>).stop_reason;
    delete (r as Partial<typeof r>).speed;
    mocks.display.mockResolvedValue({
      data: { ...d, funded_runtime: r },
      error: null,
    });
    expect((await readPrincipalWithdrawal(identity)).available).toBe(false);
  });
  it("a current global/withdrawal pause blocks fresh advisory eligibility", async () => {
    rows.safe_mode_controls.data = [{ is_paused: true, starts_at: at }];
    expect((await readPrincipalWithdrawal(identity)).available).toBe(false);
  });
  it.each([
    "money_source_summaries",
    "wallet_balance_snapshots",
    "withdrawal_policies",
    "withdrawal_destinations",
    "safe_mode_controls",
  ])("read failure %s does not become zero/available", async (name) => {
    rows[name]!.error = { message: "internal-private-error" };
    expect(await readPrincipalWithdrawal(identity)).toEqual({
      schemaVersion: 1,
      available: false,
    });
  });
  it("unmasked destination material cannot pass the safe read envelope", async () => {
    rows.withdrawal_destinations.data = [
      {
        id: dest,
        display_hint: "KB 123456789012",
        verification_status: "VERIFIED",
        protection_until: at,
      },
    ];
    expect((await readPrincipalWithdrawal(identity)).available).toBe(false);
  });
  it("absence of withdrawal configuration returns unavailable without reading secrets", async () => {
    vi.stubEnv("WITHDRAWAL_DATA_KEY", "");
    expect(await readPrincipalWithdrawal(identity)).toEqual({
      schemaVersion: 1,
      available: false,
    });
    expect(mocks.display).not.toHaveBeenCalled();
  });
  it("destination read never references ungranted owner or material columns", async () => {
    expect((await readPrincipalWithdrawal(identity)).available).toBe(true);
    const fields = queries.withdrawal_destinations![0]!.mock.calls[0]![0];
    expect(fields).toBe("id,display_hint,verification_status,protection_until");
    expect(
      queries.withdrawal_destinations![1]!.mock.calls.some(
        (call) => call[0] === "user_id",
      ),
    ).toBe(false);
    expect(queries.wallet_balance_snapshots![1]!.mock.calls).toContainEqual([
      "user_id",
      owner,
    ]);
  });
  it("initial DTO2 before any principal hold remains usable with exact member safe-column ACL", async () => {
    const data = display();
    data.funded_runtime.state_revision = "1";
    data.funded_runtime.condition_revision = "1";
    data.funded_runtime.committed_reward_total_atomic = "0";
    rows.money_source_summaries.data = {
      schema_version: 2,
      coverage: "COMPLETE",
      eligible_principal_atomic: "100000",
      held_principal_atomic: "0",
    };
    mocks.display.mockResolvedValue({ data, error: null });
    const guarded = {
      userId: owner,
      supabase: {
        from: (name: string) => {
          const q = query(name);
          if (name === "withdrawal_destinations")
            q.eq = vi.fn((column: string) => {
              if (column === "user_id")
                throw new Error("42501 ungranted member destination column");
              return q;
            });
          return q;
        },
      },
    } as unknown as VerifiedIdentity;
    const result = await readPrincipalWithdrawal(guarded);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("expected original initial facts");
    expect(result.heldPrincipalKrw).toBe("0");
    expect(result.conditionRevision).toBe("1");
  });

  it("a changed highest current bank policy omits previously valid destination without older-policy fallback", async () => {
    rows.withdrawal_policies.data = {
      id: policy,
      version: 22,
      minimum_amount_atomic: "1000",
      fee_atomic: "0",
      destination_config: { allowed_bank_codes: ["NH"] },
    };
    const result = await readPrincipalWithdrawal(identity);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("expected current safe facts");
    expect(result.destinations).toEqual([]);
    expect(result.policy.version).toBe(22);
    expect(
      mocks.adminFrom.mock.calls.filter((c) => c[0] === "withdrawal_policies"),
    ).toHaveLength(1);
  });
  it("mixed mature bank destinations include only the current allowed bank while retaining safe facts", async () => {
    rows.withdrawal_destinations.data = [
      {
        id: dest,
        display_hint: "KB ****1234",
        verification_status: "VERIFIED",
        protection_until: at,
      },
      {
        id: owner,
        display_hint: "NH ****5678",
        verification_status: "VERIFIED",
        protection_until: at,
      },
    ];
    const result = await readPrincipalWithdrawal(identity);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("expected mixed safe facts");
    expect(result.destinations).toEqual([
      { id: dest, displayHint: "KB ****1234" },
    ]);
    expect(result.eligiblePrincipalKrw).toBe("100000");
    expect(result.walletAvailableKrw).toBe("95000");
  });
  it.each(["kb ****1234", " KB ****1234", "KBX ****1234"])(
    "malformed/nonmatching public hint prefix %s never becomes an allowed bank",
    async (displayHint) => {
      rows.withdrawal_destinations.data = [
        {
          id: dest,
          display_hint: displayHint,
          verification_status: "VERIFIED",
          protection_until: at,
        },
      ];
      const result = await readPrincipalWithdrawal(identity);
      expect(result.available && result.destinations).toEqual([]);
    },
  );
});
