import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  areAllQueuesEmpty,
  auditActionLabel,
  buildTodaySnapshot,
  combineCounts,
  formatCountDisplay,
  sumAttention,
  toCountStatus,
  type CountSource,
} from "@/app/(control)/_lib/today-snapshot";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const todayLoaderSource = readFileSync(
  join(adminRoot, "app/(control)/_lib/load-today-snapshot.ts"),
  "utf8",
);

const ok = (count: number): CountSource => ({ count, error: null });
const fail = (): CountSource => ({
  count: null,
  error: { message: "lookup failed" },
});

describe("today snapshot counts", () => {
  it("keeps exact ready counts and never invents numbers", () => {
    expect(toCountStatus(ok(0))).toEqual({ kind: "ready", count: 0 });
    expect(toCountStatus(ok(12))).toEqual({ kind: "ready", count: 12 });
    expect(formatCountDisplay({ kind: "ready", count: 1200 })).toBe("1,200");
  });

  it("marks failed or null counts as unavailable instead of zero", () => {
    expect(toCountStatus(fail())).toEqual({ kind: "unavailable" });
    expect(toCountStatus({ count: null, error: null })).toEqual({
      kind: "unavailable",
    });
    expect(formatCountDisplay({ kind: "unavailable" })).toBe("확인 필요");
  });

  it("combines exception sources and fails closed on partial error", () => {
    expect(combineCounts(ok(2), ok(3))).toEqual({ kind: "ready", count: 5 });
    expect(combineCounts(ok(2), fail())).toEqual({ kind: "unavailable" });
  });

  it("builds empty-queue and unavailable snapshot states", () => {
    const empty = buildTodaySnapshot({
      usdtDeposits: ok(0),
      krwWithdrawals: ok(0),
      usdtWithdrawals: ok(0),
      kyc: ok(0),
      mismatches: ok(0),
      failedJobs: ok(0),
      safePaused: ok(0),
      users: ok(4),
      trials: ok(1),
      audits: { error: null, data: [] },
      observedAt: new Date("2026-09-29T00:00:00.000Z"),
    });

    expect(empty.allQueuesEmpty).toBe(true);
    expect(empty.hasUnavailable).toBe(false);
    expect(empty.attentionTotal).toEqual({ kind: "ready", count: 0 });
    expect(areAllQueuesEmpty(empty.attention)).toBe(true);
    expect(sumAttention(empty.attention)).toEqual({ kind: "ready", count: 0 });

    const partial = buildTodaySnapshot({
      usdtDeposits: ok(1),
      krwWithdrawals: fail(),
      usdtWithdrawals: ok(0),
      kyc: ok(0),
      mismatches: ok(0),
      failedJobs: ok(2),
      safePaused: ok(0),
      users: ok(9),
      trials: fail(),
      audits: { error: { message: "audit down" }, data: null },
      observedAt: new Date("2026-09-29T00:00:00.000Z"),
    });

    expect(partial.allQueuesEmpty).toBe(false);
    expect(partial.hasUnavailable).toBe(true);
    expect(partial.attentionTotal.kind).toBe("unavailable");
    expect(partial.activeTrials.kind).toBe("unavailable");
    expect(partial.audits).toBe("unavailable");
    expect(
      partial.attention.find((item) => item.code === "KRW_BANK")?.status,
    ).toEqual({ kind: "unavailable" });
    expect(
      partial.attention.find((item) => item.code === "EXCEPTION")?.status,
    ).toEqual({ kind: "ready", count: 2 });
  });

  it("maps audit actions to Korean operator labels", () => {
    expect(auditActionLabel("APPROVE_DEPOSIT")).toBe("입금 확인");
    expect(auditActionLabel("UNKNOWN_RPC")).toBe("운영 조치");
  });

  it("counts USDT deposit attention from usdt_manual_deposits SUBMITTED only", () => {
    // 레거시 deposit_requests / crypto_deposits로 되돌리면 이 테스트가 실패한다.
    expect(todayLoaderSource).toMatch(
      /\.from\(\s*"usdt_manual_deposits"\s*\)[\s\S]*?\.eq\(\s*"status"\s*,\s*"SUBMITTED"\s*\)/,
    );
    expect(todayLoaderSource).not.toContain('.from("deposit_requests")');
    expect(todayLoaderSource).not.toContain(".from('deposit_requests')");
    expect(todayLoaderSource).not.toContain('.from("crypto_deposits")');
    expect(todayLoaderSource).not.toContain("AWAITING_TRANSFER");
    expect(todayLoaderSource).toContain(
      "usdtDeposits: asCountSource(usdtDeposits)",
    );
  });
});
