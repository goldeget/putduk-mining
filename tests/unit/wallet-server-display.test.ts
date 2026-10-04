import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  labelWalletEntryType,
  walletEntryLabels,
} from "@/domain/wallet/wallet-read";
import type { MiningServerDisplay } from "@/lib/product/mining-server-display";
import { presentWalletServerDisplay } from "@/lib/product/wallet-server-display";

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
  retention_unconfirmed_micro_krw: "25000000000",
};

function readyRows() {
  const view = presentWalletServerDisplay(readyDisplay);
  expect(view.state).toBe("ready");
  if (view.state !== "ready") {
    return [];
  }
  return view.rows;
}

describe("지갑 서버 표시", () => {
  it("인정 원금과 대기 수익과 미확정 금액을 합치지 않는다", () => {
    const byLabel = Object.fromEntries(
      readyRows().map((row) => [row.label, row.value]),
    );

    expect(byLabel["인정 원금"]).toBe("100,000원");
    expect(byLabel["정산 전 대기 수익"]).toBe("15,000원");
    expect(byLabel["아직 확정 전"]).toBe("25,000원");
    expect(readyRows().find((row) => row.label === "아직 확정 전")?.tone).toBe(
      "unconfirmed",
    );
    expect(Object.values(byLabel)).not.toContain("115,000원");
    expect(Object.values(byLabel)).not.toContain("125,000원");
    expect(Object.values(byLabel)).not.toContain("40,000원");
    expect(Object.values(byLabel)).not.toContain("140,000원");
    expect(
      readyRows()
        .map((row) => row.label)
        .join(" "),
    ).not.toMatch(/micro|pending|retention|bonus|capacity|tier/i);
  });

  it("없는 금액은 0원으로 만들지 않는다", () => {
    expect(
      presentWalletServerDisplay({
        ...readyDisplay,
        available: false,
        eligible_principal_micro_krw: null,
        pending_micro_krw: null,
        retention_unconfirmed_micro_krw: null,
      }),
    ).toEqual({ state: "empty" });

    const view = presentWalletServerDisplay({
      ...readyDisplay,
      eligible_principal_micro_krw: null,
      pending_micro_krw: null,
      retention_unconfirmed_micro_krw: null,
    });
    expect(view.state).toBe("ready");
    if (view.state !== "ready") {
      return;
    }
    expect(view.rows.map((row) => row.value)).toEqual([
      "아직 없어요",
      "아직 없어요",
      "아직 없어요",
    ]);
    expect(view.rows.map((row) => row.value)).not.toContain("0원");
  });

  it("보너스와 채굴 보상을 원금이라고 부르지 않는다", () => {
    expect(labelWalletEntryType("MINING_REWARD")).toBe("채굴 보상");
    expect(labelWalletEntryType("BONUS")).not.toMatch(/원금/);
    expect(labelWalletEntryType("SIGNUP_BONUS")).not.toMatch(/원금/);
    expect(labelWalletEntryType("ADMIN_BONUS")).not.toMatch(/원금/);
    expect(labelWalletEntryType("EVENT_BONUS")).not.toMatch(/원금/);
    expect(Object.values(walletEntryLabels).join(" ")).not.toMatch(/원금/);
    expect(
      readyRows()
        .filter((row) => row.label.includes("원금"))
        .map((row) => row.label),
    ).toEqual(["인정 원금"]);
  });

  it("지갑 화면은 로그인한 회원 본인만 서버 역할로 읽는다", () => {
    const page = readFileSync(
      new URL("../../app/(product)/wallet/page.tsx", import.meta.url),
      "utf8",
    );
    const view = readFileSync(
      new URL("../../components/product/wallet-read-view.tsx", import.meta.url),
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
    expect(page).toContain("presentWalletServerDisplay(parsedDisplay)");
    expect(page).not.toContain("identity.supabase.rpc");
    expect(page).not.toContain("createSupabaseAdminClient");
    expect(view).not.toContain("formatMiningMicroKrw");
    expect(view).not.toContain("eligible_principal_micro_krw");
    expect(view).not.toContain("pending_micro_krw");
    expect(view).not.toContain("retention_unconfirmed_micro_krw");
    expect(reader).toContain('import "server-only"');
    expect(reader).toContain("createSupabaseAdminClient()");
    expect(reader).toContain("p_user_id: sessionUserId");
    expect(reader).toContain("const sessionUserId = identity.userId");
    expect(reader).not.toContain("requestedUserId");
  });
});
