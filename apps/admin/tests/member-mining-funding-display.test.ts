import { describe, expect, it } from "vitest";

import { presentAdminMiningFunding } from "@/app/(control)/members/_lib/mining-funding-display";

const ready = {
  active_rounds: 2,
  completed_rounds: 5,
  total_stake: "100000000000",
  total_settlement: "30000000000",
  pending_settlement: "15000000000",
  cycle_started_at: "2026-10-04T01:00:00.000Z",
  cycle_end: "2026-11-03T01:00:00.000Z",
};

function viewOf(data: unknown, error: unknown = null) {
  return presentAdminMiningFunding({ data, error });
}

function labels(data: unknown, error: unknown = null) {
  const view = viewOf(data, error);
  return Object.fromEntries(view.rows.map((row) => [row.label, row.value]));
}

function monitoringLabels(data: unknown, error: unknown = null) {
  const view = viewOf(data, error);
  return Object.fromEntries(
    view.monitoringRows.map((row) => [row.label, row.value]),
  );
}

function cycleLabels(data: unknown, error: unknown = null) {
  const view = viewOf(data, error);
  return Object.fromEntries(
    view.cycleRows.map((row) => [row.label, row.value]),
  );
}

describe("admin monitoring funding display", () => {
  it("shows stake, pending earnings, and confirmed earnings apart", () => {
    const view = presentAdminMiningFunding({ data: ready, error: null });
    expect(view.state).toBe("ready");
    const byLabel = labels(ready);
    expect(byLabel["모니터링 투자금"]).toBe("10,000,000원");
    expect(byLabel["정산 전 대기 수익"]).toBe("1,500,000원");
    expect(byLabel["확정 수익"]).toBe("3,000,000원");
    expect(view.rows.find((row) => row.label === "정산 전 대기 수익")?.tone).toBe(
      "unconfirmed",
    );
    expect(view.rows.find((row) => row.label === "확정 수익")?.tone).toBe(
      "highlight",
    );
    expect(Object.values(byLabel)).not.toContain("11,500,000원");
    expect(Object.values(byLabel)).not.toContain("13,000,000원");
  });

  it("shows active and completed monitoring counts", () => {
    expect(monitoringLabels(ready)).toEqual({
      "활성 모니터링": "2건",
      "완료 모니터링": "5건",
    });
  });

  it("shows cycle dates when available", () => {
    const cycles = cycleLabels(ready);
    expect(cycles["시작"]).toBe(ready.cycle_started_at);
    expect(cycles["종료"]).toBe(ready.cycle_end);
  });

  it("returns empty when no data", () => {
    const view = viewOf(null);
    expect(view.state).toBe("empty");
    expect(view.rows).toEqual([]);
    expect(view.monitoringRows).toEqual([]);
  });

  it("returns unavailable on error", () => {
    const view = viewOf(null, new Error("fail"));
    expect(view.state).toBe("unavailable");
    expect(view.rows).toEqual([]);
  });

  it("returns empty when all amounts are zero", () => {
    const view = viewOf({
      active_rounds: 0,
      completed_rounds: 0,
      total_stake: "0",
      total_settlement: "0",
      pending_settlement: "0",
    });
    expect(view.state).toBe("empty");
  });

  it("does not expose raw field names in labels", () => {
    const view = viewOf(ready);
    const allLabels = [
      ...view.rows,
      ...view.monitoringRows,
      ...view.cycleRows,
    ]
      .map((row) => row.label)
      .join(" ");
    expect(allLabels).not.toMatch(/micro|stake|settlement|atomic/i);
  });
});
