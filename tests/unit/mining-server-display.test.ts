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
    expect(page).toContain("displayResponse.data != null");
    expect(page).not.toContain(
      "const displayError = Boolean(displayResponse.error) || !parsedDisplay",
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
