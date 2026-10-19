/**
 * 원화 입금 안내 계좌. 운영자가 서버 설정으로 정하는 공개 안내다.
 *
 * - 비밀 값이 아니다. 회원이 이체할 곳이므로 화면에 글자로 보여 준다.
 * - React 코드에 숫자를 넣지 않는다. 서버가 설정에서 읽어 prop으로 넘긴다.
 * - 일부만 있거나 형식이 맞지 않으면 안내하지 않는다(null).
 * - 금액은 여기서 정하지 않는다. 입금 반영 금액은 서버 명령이 정한다.
 */

export const KRW_DEPOSIT_INSTRUCTION_ENV = {
  accountHolder: "KRW_DEPOSIT_ACCOUNT_HOLDER",
  accountNumber: "KRW_DEPOSIT_ACCOUNT_NUMBER",
  bankName: "KRW_DEPOSIT_BANK_NAME",
} as const;

export type KrwDepositInstruction = {
  accountHolder: string;
  accountNumber: string;
  bankName: string;
};

function clean(value: string | undefined): string {
  // 제어 문자와 연속 공백을 정리한다.
  return (value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseKrwDepositInstruction(
  env: Record<string, string | undefined>,
): KrwDepositInstruction | null {
  const bankName = clean(env[KRW_DEPOSIT_INSTRUCTION_ENV.bankName]);
  const accountNumber = clean(env[KRW_DEPOSIT_INSTRUCTION_ENV.accountNumber]);
  const accountHolder = clean(env[KRW_DEPOSIT_INSTRUCTION_ENV.accountHolder]);

  if (bankName.length < 2 || bankName.length > 30) return null;
  if (accountHolder.length < 2 || accountHolder.length > 40) return null;
  // 숫자와 하이픈만 허용하고, 숫자는 8자리 이상이어야 한다.
  if (!/^[0-9][0-9-]{5,28}[0-9]$/.test(accountNumber)) return null;
  if (accountNumber.replace(/-/g, "").length < 8) return null;
  if (/--/.test(accountNumber)) return null;

  return { accountHolder, accountNumber, bankName };
}
