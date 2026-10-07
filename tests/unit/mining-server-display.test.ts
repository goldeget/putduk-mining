import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  emptyMiningServerDisplay,
  formatMiningMicroKrw,
  formatMiningSpeedBps,
  parseMiningServerDisplay,
  presentMiningServerDisplay,
  resolveMiningServerDisplayRead,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";

const readyDisplay: MiningServerDisplay = {
  available: true,
  eligible_principal_micro_krw: "100000000000",
  tier_code: "L1",
  tier_activated: true,
  cycle_started_at: "2026-10-04T01:00:00.000Z",
  cycle_end: "2026-11-03T01:00:00.000Z",
  effective_capacity_micro_krw: "15000000000",
  remaining_capacity_micro_krw: "15000000000",
  used_capacity_micro_krw: "0",
  speed_multiplier_bps: "10000",
  pending_micro_krw: "15000000000",
  retention_unconfirmed_micro_krw: "15000000000",
};

describe("presentMiningServerDisplay", () => {
  test("shows the effective paid ratio instead of the configured legacy factor", () => {
    const runtime = {
      schema_version: 2,
      runtime_version: 2,
      state_revision: "1",
      condition_revision: "1",
      accepted_cursor_at: "2026-10-06T11:00:00.000000Z",
      evaluated_at: "2026-10-06T11:00:01.000000Z",
      allocation_bps: "5000",
      committed_reward_total_atomic: "12",
      reward_carry: { numerator: "0", denominator: "1", unit: "KRW" },
      conditional_maintenance: {
        numerator: "7",
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
        effective_global_multiplier: { numerator: "1", denominator: "2" },
      },
    } as const;
    const speed = (funded_runtime: unknown) => {
      const parsed = parseMiningServerDisplay({
        ...readyDisplay,
        funded_runtime,
      });
      expect(parsed).not.toBeNull();
      const view = presentMiningServerDisplay(parsed!);
      return view.state === "ready"
        ? view.rows.find((row) => row.label === "속도")?.value
        : undefined;
    };
    expect(speed(runtime)).toBe("0.5배");
    expect(
      speed({
        ...runtime,
        speed: {
          ...runtime.speed,
          effective_global_multiplier: { numerator: "33", denominator: "40" },
        },
      }),
    ).toBe("0.825배");
    expect(
      speed({
        ...runtime,
        speed: {
          ...runtime.speed,
          effective_global_multiplier: { numerator: "1", denominator: "3" },
        },
      }),
    ).toBe("약 0.333333배");
    const historical = Object.fromEntries(
      Object.entries(runtime).filter(
        ([field]) => !["status", "stop_reason", "speed"].includes(field),
      ),
    );
    expect(speed({ ...historical, schema_version: 1 })).toBe(
      "확인할 수 없어요",
    );
  });

  test("uses the published micro and basis-point units only for display", () => {
    const policy = readFileSync(
      new URL("../../domain/mining/economy-policy.ts", import.meta.url),
      "utf8",
    );
    expect(policy).toMatch(/export const MICRO_KRW_PER_KRW = 1_000_000n/);
    expect(policy).toMatch(/export const BASIS_POINT_UNIT = 10_000n/);
    expect(formatMiningMicroKrw("1000000")).toBe("1원");
    expect(formatMiningSpeedBps("10000")).toBe("1배");
  });
  test("keeps sub-won accrual truthful without exposing micro units or rounding a credit", () => {
    expect(formatMiningMicroKrw("0")).toBe("0원");
    expect(formatMiningMicroKrw("1")).toBe("1원 미만");
    expect(formatMiningMicroKrw("999999")).toBe("1원 미만");
    expect(formatMiningMicroKrw("1999999")).toBe("약 1원");
    expect(formatMiningMicroKrw("29999983878")).toBe("약 29,999원");
    expect(formatMiningMicroKrw("9007199254740993000001")).toBe(
      "약 9,007,199,254,740,993원",
    );
  });
  test("shows server amounts and keeps unconfirmed retention apart from pending", () => {
    const view = presentMiningServerDisplay(readyDisplay);
    expect(view.state).toBe("ready");
    if (view.state !== "ready") {
      return;
    }
    const byLabel = Object.fromEntries(
      view.rows.map((row) => [row.label, row.value]),
    );
    expect(byLabel["인정 원금"]).toBe("100,000원");
    expect(byLabel["등급"]).toBe("L1");
    expect(byLabel["이번 한도"]).toBe("15,000원");
    expect(byLabel["남은 한도"]).toBe("15,000원");
    expect(byLabel["사용한 한도"]).toBe("0원");
    expect(byLabel["속도"]).toBe("1배");
    expect(byLabel["정산 전"]).toBe("15,000원");
    expect(byLabel["확인 전"]).toBe("15,000원");
    expect(byLabel["정산 전"]).not.toBe("30,000원");
    expect(Object.values(byLabel)).not.toContain("30,000원");
    expect(view.rows.map((row) => row.label).join(" ")).not.toMatch(
      /micro|bps|pending|capacity|tier/i,
    );
  });

  test("uses an empty state when the server has no funding subject", () => {
    expect(
      presentMiningServerDisplay({
        ...readyDisplay,
        available: false,
        eligible_principal_micro_krw: null,
        tier_code: null,
        tier_activated: false,
        cycle_started_at: null,
        cycle_end: null,
        effective_capacity_micro_krw: null,
        remaining_capacity_micro_krw: null,
        used_capacity_micro_krw: null,
        speed_multiplier_bps: null,
        pending_micro_krw: null,
        retention_unconfirmed_micro_krw: null,
      }),
    ).toEqual({ state: "empty" });
  });

  test("does not invent a number for a missing amount", () => {
    expect(formatMiningMicroKrw(null)).toBe("아직 없어요");
    expect(formatMiningMicroKrw("12.5")).toBe("확인할 수 없어요");
    expect(formatMiningSpeedBps(null)).toBe("아직 없어요");
    expect(formatMiningSpeedBps("15000")).toBe("1.5배");
  });

  test("reads the signed-in member through the server role only", () => {
    const page = readFileSync(
      new URL("../../app/(product)/mining/page.tsx", import.meta.url),
      "utf8",
    );
    const reader = readFileSync(
      new URL(
        "../../lib/product/read-mining-server-display.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(page).toContain("readOwnMiningServerDisplay(identity)");
    expect(page).toContain("parseMiningServerDisplay(displayResponse.data)");
    expect(page).toContain(
      "const displayError = Boolean(displayResponse.error) || !display",
    );
    expect(page).toMatch(
      /resolveMiningPresentation\(\{\s*display,\s*displayError,/s,
    );
    expect(page).not.toContain("identity.supabase.rpc");
    expect(reader).toContain('import "server-only"');
    expect(reader).toContain("createSupabaseAdminClient()");
    expect(reader).toContain("p_user_id: sessionUserId");
    expect(reader).toContain("const sessionUserId = identity.userId");
    expect(reader).toContain('from("funding_principal_lots")');
    expect(reader).toContain('.select("id")');
    expect(reader).toContain("resolveMiningServerDisplayRead");
    expect(reader).not.toContain("requestedUserId");
    expect(reader).not.toContain('eligible_principal_micro_krw: "0"');
  });

  test("a missing principal row is an empty display, not an error or zero", () => {
    expect(emptyMiningServerDisplay.eligible_principal_micro_krw).toBeNull();
    expect(emptyMiningServerDisplay.pending_micro_krw).toBeNull();
    expect(
      resolveMiningServerDisplayRead({ data: null, error: null }, null),
    ).toEqual({ data: emptyMiningServerDisplay, error: null });
    expect(
      resolveMiningServerDisplayRead(
        {
          data: null,
          error: { message: "FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND" },
        },
        null,
      ),
    ).toEqual({ data: emptyMiningServerDisplay, error: null });
    expect(
      resolveMiningServerDisplayRead(
        {
          data: null,
          error: {
            code: "PGRST202",
            message:
              "Could not find the function public.read_own_mining_server_display(p_user_id) in the schema cache",
          },
        },
        { data: [], error: null },
      ),
    ).toEqual({ data: emptyMiningServerDisplay, error: null });
    expect(presentMiningServerDisplay(emptyMiningServerDisplay)).toEqual({
      state: "empty",
    });
  });

  test("keeps a real read failure when a principal row exists", () => {
    const failure = {
      data: null,
      error: { code: "42501", message: "permission denied" },
    };
    expect(
      resolveMiningServerDisplayRead(failure, {
        data: [{ id: "lot-1" }],
        error: null,
      }),
    ).toBe(failure);
    expect(
      resolveMiningServerDisplayRead(failure, {
        data: null,
        error: { message: "lots unavailable" },
      }),
    ).toBe(failure);
    const zero = resolveMiningServerDisplayRead(
      {
        data: { ...readyDisplay, eligible_principal_micro_krw: "0" },
        error: null,
      },
      { data: [], error: null },
    );
    expect(zero.error).toBeNull();
    expect(zero.data).toMatchObject({
      available: true,
      eligible_principal_micro_krw: "0",
    });
  });

  test("rejects internal columns before they can reach the screen", () => {
    expect(
      parseMiningServerDisplay({
        ...readyDisplay,
        segments: [],
        policy_id: "secret",
      }),
    ).toBeNull();
    expect(parseMiningServerDisplay(readyDisplay)?.pending_micro_krw).toBe(
      "15000000000",
    );
    expect(
      parseMiningServerDisplay(JSON.stringify(readyDisplay))?.tier_code,
    ).toBe("L1");
  });
});
