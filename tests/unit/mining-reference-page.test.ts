import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MiningPage from "@/app/(product)/mining/page";
import { emptyMiningServerDisplay } from "@/lib/product/mining-server-display";

const fixture = vi.hoisted(() => ({
  reads: {} as Record<string, { data: unknown; error: unknown }>,
  display: { data: null as unknown, error: null as unknown },
  calls: [] as { table: string; filters: [string, unknown][] }[],
}));
vi.mock("@/lib/auth/session", () => ({
  requirePageUser: vi.fn(async () => ({
    userId: "verified-owner",
    supabase: {
      from(table: string) {
        const call = { table, filters: [] as [string, unknown][] };
        fixture.calls.push(call);
        const chain = {
          select() {
            return chain;
          },
          eq(key: string, value: unknown) {
            call.filters.push([key, value]);
            return chain;
          },
          order() {
            return chain;
          },
          limit() {
            return chain;
          },
          maybeSingle() {
            return chain;
          },
          then(
            resolve: (value: { data: unknown; error: unknown }) => unknown,
            reject?: (reason: unknown) => unknown,
          ) {
            return Promise.resolve(
              fixture.reads[table] ?? { data: [], error: null },
            ).then(resolve, reject);
          },
        };
        return chain;
      },
    },
  })),
}));
vi.mock("@/lib/product/read-mining-server-display", () => ({
  readOwnMiningServerDisplay: vi.fn(async () => fixture.display),
}));
vi.mock("@/components/mining-live/mining-reference-scene", () => ({
  MiningReferenceScene: ({ running }: { running: boolean }) =>
    createElement("div", { "data-mining-running": String(running) }),
}));
vi.mock("@/components/product/route-reload-button", () => ({
  RouteReloadButton: ({ label = "다시 확인" }: { label?: string }) =>
    createElement("button", { type: "button" }, label),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

beforeEach(() => {
  fixture.calls = [];
  fixture.display = {
    data: { ...emptyMiningServerDisplay, available: true },
    error: null,
  };
  fixture.reads = {
    mining_active_session_snapshots: { data: [], error: null },
    asset_worlds: { data: [], error: null },
    wallet_balance_snapshots: {
      data: { wallet_account_id: "owner-krw-account" },
      error: null,
    },
    trial_account_snapshots: { data: { status: "READY" }, error: null },
    transaction_receipts: { data: [], error: null },
    wallet_ledger: {
      data: [
        {
          id: "credit-1",
          direction: "CREDIT",
          entry_type: "MINING_REWARD",
          amount_atomic: "12",
          created_at: "2026-10-06T01:00:00Z",
        },
      ],
      error: null,
    },
  };
});

describe("mining page owned source reads", () => {
  it("keeps paid UNKNOWN fail closed while preserving independently verified START and exact credited history", async () => {
    const html = renderToStaticMarkup(await MiningPage());
    expect(html).toContain('data-mining-running="false"');
    expect(html).toContain("채굴 상태를 다시 확인해 주세요");
    expect(html).toContain("채굴 상태 다시 확인");
    expect(html).toContain("PUTDUK START 확인");
    expect(html).toContain("체험과 실제 채굴은 따로 표시해요.");
    expect(html).toContain("12원");
    expect(html).not.toContain("실제 채굴 · 채굴 중");
    for (const call of fixture.calls.filter(
      (call) => call.table !== "asset_worlds",
    )) {
      expect(call.filters).toContainEqual(["user_id", "verified-owner"]);
    }
    expect(
      fixture.calls.find((call) => call.table === "wallet_balance_snapshots")
        ?.filters,
    ).toContainEqual(["currency", "KRW"]);
    expect(
      fixture.calls.find((call) => call.table === "wallet_ledger")?.filters,
    ).toEqual([
      ["user_id", "verified-owner"],
      ["wallet_account_id", "owner-krw-account"],
      ["entry_type", "MINING_REWARD"],
      ["direction", "CREDIT"],
    ]);
  });
  it("discards retained failed account, receipt, legacy session and trial values", async () => {
    fixture.reads.wallet_balance_snapshots = {
      data: { wallet_account_id: "stale-account" },
      error: { message: "fixture read failed" },
    };
    fixture.reads.transaction_receipts = {
      data: [
        {
          id: "stale-receipt",
          amount_atomic: "999",
          currency: "KRW",
          status: "COMPLETED",
          transaction_type: "DEPOSIT",
          requested_at: "2026-10-06T01:00:00Z",
        },
      ],
      error: { message: "fixture read failed" },
    };
    fixture.reads.mining_active_session_snapshots = {
      data: [{ status: "NORMAL", world_name_ko: "retained-active-world" }],
      error: { message: "fixture read failed" },
    };
    fixture.reads.trial_account_snapshots = {
      data: { status: "ACTIVE" },
      error: { message: "fixture read failed" },
    };
    const html = renderToStaticMarkup(await MiningPage());
    expect(fixture.calls.some((call) => call.table === "wallet_ledger")).toBe(
      false,
    );
    expect(html).toContain("채굴 내역을 불러오지 못했어요.");
    expect(html).toContain("거래 내역을 불러오지 못했어요.");
    expect(html).toContain("START 상태 다시 확인");
    expect(html).not.toContain("999원");
    expect(html).not.toContain("retained-active-world");
    expect(html).not.toContain("START 계속하기");
    expect(html).toContain('data-mining-running="false"');
  });
});
