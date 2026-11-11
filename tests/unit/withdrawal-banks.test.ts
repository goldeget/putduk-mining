import { describe, expect, it, vi } from "vitest";
import {
  isWithdrawalBankCode,
  WITHDRAWAL_BANKS,
  withdrawalBankLabel,
  withdrawalBankOptions,
} from "@/lib/wallet/withdrawal-banks";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";

vi.mock("server-only", () => ({}));

// Independent complete retail-deposit bank/code contract; do not derive this
// expectation from the production catalog being tested.
const expected = {
  KDB: "002",
  IBK: "003",
  KB: "004",
  SUHYUP: "007",
  NH: "011",
  WOORI: "020",
  SC: "023",
  CITI: "027",
  IM: "031",
  BUSAN: "032",
  GWANGJU: "034",
  JEJU: "035",
  JEONBUK: "037",
  GYEONGNAM: "039",
  KEB_HANA: "081",
  SHINHAN: "088",
  KBANK: "089",
  KAKAO: "090",
  TOSS: "092",
};
const destination = {
  method: "KRW_BANK",
  accountHolder: "홍길동",
  accountNumber: "1101234567890",
} as const;

describe("국내 입출금 은행 목록", () => {
  it("운영자 표시에는 은행명을 쓰고 알 수 없는 과거 값은 보존한다", () => {
    expect(withdrawalBankLabel("CITI")).toBe("한국씨티은행");
    expect(withdrawalBankLabel("IM")).toBe("iM뱅크 (구 대구은행)");
    expect(withdrawalBankLabel("LEGACY_BANK")).toBe("LEGACY_BANK");
  });
  it("19개 은행의 금융결제원 코드를 빠짐과 중복 없이 유지한다", () => {
    expect(
      Object.fromEntries(
        WITHDRAWAL_BANKS.map((bank) => [bank.code, bank.kftcCode]),
      ),
    ).toEqual(expected);
    expect(WITHDRAWAL_BANKS).toHaveLength(19);
    expect(new Set(WITHDRAWAL_BANKS.map((bank) => bank.kftcCode)).size).toBe(
      19,
    );
  });

  it.each(Object.keys(expected))(
    "%s 은행의 계좌 입력을 서버에서도 허용한다",
    (bankCode) => {
      const parsed = withdrawalDestinationSchema.parse({
        ...destination,
        bankCode,
      });
      expect(parsed).toEqual({ ...destination, bankCode });
      expect(isWithdrawalBankCode(bankCode)).toBe(true);
    },
  );

  it.each([
    "UNKNOWN",
    "EXIM",
    "POST",
    "CREDIT_UNION",
    "012",
    "004",
    "__proto__",
    "",
  ])("지원하지 않는 %s 코드를 서버에서 거부한다", (bankCode) => {
    expect(
      withdrawalDestinationSchema.safeParse({ ...destination, bankCode })
        .success,
    ).toBe(false);
    expect(isWithdrawalBankCode(bankCode)).toBe(false);
  });

  it("기존 9개 코드와 저장된 수취지 지문을 바꾸지 않는다", () => {
    for (const bankCode of [
      "IBK",
      "KB",
      "KAKAO",
      "KEB_HANA",
      "NH",
      "SC",
      "SHINHAN",
      "TOSS",
      "WOORI",
    ]) {
      const parsed = withdrawalDestinationSchema.parse({
        ...destination,
        bankCode: ` ${bankCode.toLowerCase()} `,
      });
      const identity = withdrawalDestinationIdentity(parsed);
      expect(parsed).toEqual({ ...destination, bankCode });
      expect(identity.sensitive).toEqual({
        accountHolder: destination.accountHolder,
        accountNumber: destination.accountNumber,
        bankCode,
      });
      expect(identity.displayHint.startsWith(`${bankCode} `)).toBe(true);
    }
  });

  it("운영 정책에 허용된 은행만 그룹으로 표시하고 미등록 정책 코드는 숨긴다", () => {
    const groups = withdrawalBankOptions([
      "KB",
      "KBANK",
      "KDB",
      "JEJU",
      "UNKNOWN",
      "KB",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "시중은행",
      "지방은행",
      "인터넷은행",
      "특수은행",
    ]);
    expect(
      groups.flatMap((group) => group.banks.map((bank) => bank.code)),
    ).toEqual(["KB", "JEJU", "KBANK", "KDB"]);
    expect(withdrawalBankOptions([])).toEqual([]);
  });
});
