import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { presentAdminMiningFunding } from "@/app/(control)/members/_lib/mining-funding-display";

const ready = {
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
  retention_unconfirmed_micro_krw: "25000000000",
};

function labels(data: unknown, error: unknown = null) {
  const view = presentAdminMiningFunding({ data, error });
  return Object.fromEntries(view.rows.map((row) => [row.label, row.value]));
}

describe("admin mining funding display", () => {
  it("shows principal, pending earnings, and unconfirmed amounts apart", () => {
    const view = presentAdminMiningFunding({ data: ready, error: null });
    expect(view.state).toBe("ready");
    const byLabel = labels(ready);
    expect(byLabel["인정 원금"]).toBe("100,000원");
    expect(byLabel["정산 전 대기 수익"]).toBe("15,000원");
    expect(byLabel["아직 확정 전"]).toBe("25,000원");
    expect(view.rows.find((row) => row.label === "아직 확정 전")?.tone).toBe(
      "unconfirmed",
    );
    expect(Object.values(byLabel)).not.toContain("115,000원");
    expect(Object.values(byLabel)).not.toContain("125,000원");
    expect(Object.values(byLabel)).not.toContain("40,000원");
    expect(Object.values(byLabel)).not.toContain("140,000원");
    expect(view.rows.map((row) => row.label).join(" ")).not.toMatch(
      /micro|pending|retention|bonus|capacity|tier/i,
    );
    expect(view.rows.filter((row) => row.label.includes("원금"))).toEqual([
      { label: "인정 원금", value: "100,000원", tone: "separate" },
    ]);
  });

  it("keeps a server zero and does not turn a missing amount into zero", () => {
    expect(
      labels({
        ...ready,
        eligible_principal_micro_krw: "0",
        pending_micro_krw: "0",
        retention_unconfirmed_micro_krw: "0",
      }),
    ).toEqual({
      "인정 원금": "0원",
      "정산 전 대기 수익": "0원",
      "아직 확정 전": "0원",
    });
    expect(
      labels({
        ...ready,
        eligible_principal_micro_krw: null,
        pending_micro_krw: null,
        retention_unconfirmed_micro_krw: null,
      }),
    ).toEqual({
      "인정 원금": "아직 없어요",
      "정산 전 대기 수익": "아직 없어요",
      "아직 확정 전": "아직 없어요",
    });
  });

  it("does not show an empty funding subject as zero", () => {
    expect(
      presentAdminMiningFunding({
        data: {
          ...ready,
          available: false,
          eligible_principal_micro_krw: null,
          pending_micro_krw: null,
          retention_unconfirmed_micro_krw: null,
        },
        error: null,
      }),
    ).toEqual({ state: "empty", rows: [] });
  });

  it("a read error or a bonus field cannot become principal", () => {
    const failed = presentAdminMiningFunding({
      data: ready,
      error: { code: "42501" },
    });
    expect(failed.state).toBe("unavailable");
    expect(failed.rows.map((row) => row.value)).toEqual([
      "확인 필요",
      "확인 필요",
      "확인 필요",
    ]);
    expect(failed.rows.map((row) => row.value)).not.toContain("0원");

    const bonus = presentAdminMiningFunding({
      data: { ...ready, recorded_bonus_atomic: "3000" },
      error: null,
    });
    expect(bonus.state).toBe("unavailable");
    expect(bonus.rows.map((row) => row.value)).not.toContain("3,000원");
    expect(bonus.rows.map((row) => row.label).join(" ")).not.toMatch(/보너스/);
  });

  it("reads the member through the admin service role only", () => {
    const page = readFileSync(
      new URL("../app/(control)/members/page.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toContain(
      'db.rpc("read_own_mining_server_display", { p_user_id: userId })',
    );
    expect(page).toContain("createAdminServiceClient()");
    expect(page).not.toContain("app_private");
    expect(page).not.toMatch(/security definer/i);
    expect(page).not.toContain("grant execute");
  });
});
