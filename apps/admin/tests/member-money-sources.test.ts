import { describe, expect, it } from "vitest";

import { formatKrw } from "@/app/(control)/_lib/format";
import { presentMemberMoneySources } from "@/app/(control)/members/_lib/money-source-display";

const owner = "0d460000-0000-4000-8000-000000000101";
const snapshot = {
  user_id: owner,
  schema_version: 1,
  coverage: "COMPLETE",
  unclassified_wallet_entries: "0",
  unconnected_withdrawals: "0",
  unclassified_journals: "0",
  invalid_source_receipts: "0",
  eligible_principal_atomic: "15000",
  recorded_krw_principal_deposits_atomic: "10000",
  recorded_usdt_principal_credits_atomic: "5000",
  recorded_bonus_atomic: "3000",
  observed_at: "2026-10-03T08:20:00+00:00",
  capture_started_at: "2026-10-03T08:12:00+00:00",
};
const present = (data: unknown = snapshot, error: unknown = null) =>
  presentMemberMoneySources({ data, error }, owner);

describe("money source operator evidence", () => {
  it("shows principal and bonus separately without guessing tier or pending rewards", () => {
    const result = present();
    expect(result.available).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.rows).toContainEqual(["채굴 인정 원금", "15,000원"]);
    expect(result.rows).toContainEqual(["현재 보너스", "3,000원"]);
    expect(result.rows).toContainEqual(["누적 보너스", "3,000원"]);
    expect(result.rows).toContainEqual(["현재 채굴 등급", "설정 전"]);
    expect(result.rows).toContainEqual(["누적 채굴 수익", "확인 필요"]);
    expect(result.rows).toContainEqual(["확정 채굴 수익", "확인 필요"]);
    expect(result.rows).toContainEqual(["누적 원금 회수", "확인 필요"]);
    expect(result.rows).toContainEqual(["총 출금", "확인 필요"]);
    expect(result.rows.map((row) => row[1])).not.toContain("18,000원");
    expect(result.rows.map((row) => row[0])).not.toContain("미확정 채굴 수익");
  });
  it("legacy unknown coverage hides eligible principal and lifetime claims", () => {
    const result = present({
      ...snapshot,
      coverage: "UNRESOLVED",
      unclassified_wallet_entries: "1",
      eligible_principal_atomic: null,
    });
    expect(result.available).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.rows).toContainEqual(["채굴 인정 원금", "확인 필요"]);
    expect(result.rows).toContainEqual(["누적 원화 원금 입금", "확인 필요"]);
    expect(result.recordedKrwDeposits).toBe("10,000원");
  });
  it.each([
    null,
    { ...snapshot, user_id: "0d460000-0000-4000-8000-000000000102" },
    { ...snapshot, eligible_principal_atomic: "18000" },
    { ...snapshot, eligible_principal_atomic: "-1" },
    { ...snapshot, eligible_principal_atomic: 15000 },
    { ...snapshot, unconnected_withdrawals: "1" },
    { ...snapshot, coverage: "UNRESOLVED" },
    { ...snapshot, observed_at: "invalid" },
    { ...snapshot, observed_at: "2026-10-03T08:00:00Z" },
  ])(
    "fails closed for a missing, foreign or inconsistent snapshot %#",
    (data) => {
      const result = present(data);
      expect(result.available).toBe(false);
      expect(result.rows).toContainEqual(["채굴 인정 원금", "확인 필요"]);
      expect(result.recordedKrwDeposits).toBe("확인 필요");
    },
  );
  it("a DB error cannot become a zero principal", () => {
    expect(present(snapshot, { code: "42501" }).rows).toContainEqual([
      "채굴 인정 원금",
      "확인 필요",
    ]);
  });
  it("keeps exact KRW display above safe Number precision", () => {
    expect(formatKrw("9007199254740993")).toBe("9,007,199,254,740,993원");
    expect(formatKrw(Number.MAX_SAFE_INTEGER + 1)).toBe("—");
    expect(formatKrw("5000garbage")).toBe("—");
    expect(formatKrw("5000.5")).toBe("—");
    expect(formatKrw(1.5)).toBe("—");
  });
});
