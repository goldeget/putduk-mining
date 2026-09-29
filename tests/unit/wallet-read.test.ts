import { describe, expect, it } from "vitest";

import {
  buildKrwWalletProjection,
  classifyLedgerHistoryRead,
  classifyReceiptHistoryRead,
  classifyWalletBalanceRead,
  formatWalletEvidenceTime,
  labelWalletEntryType,
  labelWalletReceiptStatus,
  projectHeldBalanceAtomic,
  requireAtomicIntegerString,
} from "@/domain/wallet/wallet-read";

describe("wallet-read 투영", () => {
  it("출금 보류를 bigint로만 계산한다", () => {
    expect(projectHeldBalanceAtomic("15000", "5000")).toBe("10000");
    expect(projectHeldBalanceAtomic("9007199254740993", "1")).toBe(
      "9007199254740992",
    );
  });

  it("소수·비정수 atomic 문자열을 거부한다", () => {
    expect(() => requireAtomicIntegerString("1.5", "amount")).toThrow(
      TypeError,
    );
    expect(() => projectHeldBalanceAtomic("10.0", "1")).toThrow(TypeError);
  });

  it("사용 가능이 전체보다 크면 거부한다", () => {
    expect(() => projectHeldBalanceAtomic("100", "101")).toThrow(RangeError);
  });

  it("스냅샷으로 KRW 투영을 만든다", () => {
    expect(
      buildKrwWalletProjection({
        availableBalanceAtomic: "2500",
        balanceAtomic: "4000",
        walletAccountId: "acct-1",
      }),
    ).toEqual({
      availableAtomic: "2500",
      balanceAtomic: "4000",
      heldAtomic: "1500",
      walletAccountId: "acct-1",
    });
  });
});

describe("wallet-read 상태 분류", () => {
  it("잔액 조회 실패·빈·0·준비 상태를 구분한다", () => {
    expect(
      classifyWalletBalanceRead({ error: true, hasAccount: false }),
    ).toBe("error");
    expect(
      classifyWalletBalanceRead({ error: false, hasAccount: false }),
    ).toBe("empty");
    expect(
      classifyWalletBalanceRead({
        availableAtomic: "0",
        balanceAtomic: "0",
        error: false,
        hasAccount: true,
      }),
    ).toBe("zero");
    expect(
      classifyWalletBalanceRead({
        availableAtomic: "1000",
        balanceAtomic: "1000",
        error: false,
        hasAccount: true,
      }),
    ).toBe("ready");
  });

  it("원장·영수증 증거를 빈·오류·준비로 구분한다", () => {
    expect(classifyLedgerHistoryRead({ count: 0, error: false })).toBe(
      "empty",
    );
    expect(classifyLedgerHistoryRead({ count: 2, error: true })).toBe("error");
    expect(classifyLedgerHistoryRead({ count: 2, error: false })).toBe(
      "ready",
    );
    expect(classifyReceiptHistoryRead({ count: 0, error: false })).toBe(
      "empty",
    );
    expect(classifyReceiptHistoryRead({ count: 1, error: true })).toBe(
      "error",
    );
  });
});

describe("wallet-read 표시", () => {
  it("거래·상태 라벨을 한국어로 제공한다", () => {
    expect(labelWalletEntryType("MINING_REWARD")).toBe("채굴 보상");
    expect(labelWalletEntryType("UNKNOWN")).toBe("지갑 변동");
    expect(labelWalletReceiptStatus("COMPLETED")).toBe("완료");
  });

  it("증거 시각을 Asia/Seoul로 고정한다", () => {
    const label = formatWalletEvidenceTime("2026-09-29T06:00:00.000Z");
    expect(label).toContain("2026");
    expect(label.length).toBeGreaterThan(8);
  });
});
