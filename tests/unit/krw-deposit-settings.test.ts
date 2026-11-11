import { describe, it, expect } from "vitest";
import {
  krwDepositSettingsSchema,
  depositPresentation,
} from "@/domain/wallet/krw-deposit-settings";
const contact = {
  mode: "CONTACT",
  bank_name: "",
  account_number: "",
  account_holder: "",
  contact_message: "1:1 상담 후 계좌 발급",
  version: 1,
};
describe("원화 입금 안내", () => {
  it("설정이 없으면 이전 계좌를 노출하지 않고 상담 안내로 닫는다", () => {
    expect(depositPresentation(null)).toMatchObject({
      instruction: null,
      contactOperator: true,
    });
  });
  it("은행, 번호, 예금주가 모두 유효해야 계좌를 표시한다", () => {
    const account = {
      ...contact,
      mode: "ACCOUNT",
      bank_name: "테스트은행",
      account_number: "123-45678901",
      account_holder: "테스트회사",
    };
    const parsed = krwDepositSettingsSchema.parse(account);
    expect(depositPresentation(parsed).instruction?.accountNumber).toBe(
      account.account_number,
    );
    for (const invalid of [
      { bank_name: "" },
      { account_holder: "" },
      { account_number: "123--45678901" },
      { account_number: "abc12345678" },
      { account_number: "1234567" },
    ])
      expect(
        krwDepositSettingsSchema.safeParse({ ...account, ...invalid }).success,
      ).toBe(false);
  });
  it("상담 모드에서는 저장된 안내 문구만 표시하고 계좌를 숨긴다", () => {
    const settings = krwDepositSettingsSchema.parse(contact);
    expect(depositPresentation(settings)).toEqual({
      instruction: null,
      contactOperator: true,
      contactMessage: contact.contact_message,
    });
  });
});
