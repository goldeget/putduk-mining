/**
 * Domestic banks offering retail deposit accounts. Internal codes are stable
 * destination identities; KFTC codes are reference metadata, never replacements.
 * Bank codes: https://imbank.co.kr/cms/fsv/sdb_2/sdb_22/sdb_222/1187032_1468.html
 * Classification: https://www.bok.or.kr/portal/main/contents.do?menuNo=200319
 * Reviewed 2026-11-11. Nonbank cooperatives, post and savings banks are separate.
 */
export const WITHDRAWAL_BANK_GROUPS = [
  {
    label: "시중은행",
    banks: [
      { code: "KB", name: "KB국민은행", kftcCode: "004" },
      { code: "SHINHAN", name: "신한은행", kftcCode: "088" },
      { code: "WOORI", name: "우리은행", kftcCode: "020" },
      { code: "KEB_HANA", name: "하나은행", kftcCode: "081" },
      { code: "SC", name: "SC제일은행", kftcCode: "023" },
      { code: "CITI", name: "한국씨티은행", kftcCode: "027" },
      { code: "IM", name: "iM뱅크 (구 대구은행)", kftcCode: "031" },
    ],
  },
  {
    label: "지방은행",
    banks: [
      { code: "BUSAN", name: "BNK부산은행", kftcCode: "032" },
      { code: "GYEONGNAM", name: "BNK경남은행", kftcCode: "039" },
      { code: "GWANGJU", name: "광주은행", kftcCode: "034" },
      { code: "JEONBUK", name: "전북은행", kftcCode: "037" },
      { code: "JEJU", name: "제주은행", kftcCode: "035" },
    ],
  },
  {
    label: "인터넷은행",
    banks: [
      { code: "KBANK", name: "케이뱅크", kftcCode: "089" },
      { code: "KAKAO", name: "카카오뱅크", kftcCode: "090" },
      { code: "TOSS", name: "토스뱅크", kftcCode: "092" },
    ],
  },
  {
    label: "특수은행",
    banks: [
      { code: "KDB", name: "KDB산업은행", kftcCode: "002" },
      { code: "IBK", name: "IBK기업은행", kftcCode: "003" },
      { code: "NH", name: "NH농협은행", kftcCode: "011" },
      { code: "SUHYUP", name: "Sh수협은행", kftcCode: "007" },
    ],
  },
] as const;

export const WITHDRAWAL_BANKS = WITHDRAWAL_BANK_GROUPS.flatMap<
  (typeof WITHDRAWAL_BANK_GROUPS)[number]["banks"][number]
>((group) => group.banks);
export type WithdrawalBankCode = (typeof WITHDRAWAL_BANKS)[number]["code"];

const supportedCodes = new Set<string>(
  WITHDRAWAL_BANKS.map((bank) => bank.code),
);
export function isWithdrawalBankCode(code: string): code is WithdrawalBankCode {
  return supportedCodes.has(code);
}

/** Unknown historical values remain readable without inventing a bank name. */
export function withdrawalBankLabel(code: string): string {
  return WITHDRAWAL_BANKS.find((bank) => bank.code === code)?.name ?? code;
}

/** Policy remains authoritative; an unrecognized policy entry is never shown. */
export function withdrawalBankOptions(allowedCodes: readonly string[]) {
  const allowed = new Set(allowedCodes);
  return WITHDRAWAL_BANK_GROUPS.map((group) => ({
    label: group.label,
    banks: group.banks.filter((bank) => allowed.has(bank.code)),
  })).filter((group) => group.banks.length > 0);
}
