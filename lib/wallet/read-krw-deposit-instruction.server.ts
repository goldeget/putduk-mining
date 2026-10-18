import "server-only";

import {
  parseKrwDepositInstruction,
  type KrwDepositInstruction,
} from "@/domain/wallet/krw-deposit-instruction";

/** 운영자가 서버 설정으로 정한 원화 입금 안내 계좌. 없거나 잘못되면 null이다. */
export function readKrwDepositInstruction(
  env: Record<string, string | undefined> = process.env,
): KrwDepositInstruction | null {
  return parseKrwDepositInstruction(env);
}
