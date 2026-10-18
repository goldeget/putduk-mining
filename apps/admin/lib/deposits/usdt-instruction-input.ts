import { z } from "zod";

export const USDT_INSTRUCTION_NETWORKS = ["TRC20", "ERC20", "BEP20"] as const;
export type UsdtInstructionNetwork = (typeof USDT_INSTRUCTION_NETWORKS)[number];

/** 오타를 막기 위한 형식 확인이다. 소유 증명이나 체인 조회가 아니다. */
const ADDRESS_PATTERN: Record<UsdtInstructionNetwork, RegExp> = {
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ERC20: /^0x[0-9a-fA-F]{40}$/,
  BEP20: /^0x[0-9a-fA-F]{40}$/,
};

export function isValidUsdtAddress(
  network: UsdtInstructionNetwork,
  address: string,
): boolean {
  return ADDRESS_PATTERN[network].test(address);
}

export const usdtInstructionInput = z
  .strictObject({
    network: z.enum(USDT_INSTRUCTION_NETWORKS),
    address: z.string().trim().min(8).max(128),
    addressRepeat: z.string().trim().min(8).max(128),
    reason: z.string().trim().min(10).max(500),
    confirmation: z.literal("SET_USDT_DEPOSIT_ADDRESS"),
  })
  .refine((value) => value.address === value.addressRepeat, {
    message: "ADDRESS_MISMATCH",
    path: ["addressRepeat"],
  })
  .refine((value) => isValidUsdtAddress(value.network, value.address), {
    message: "ADDRESS_FORMAT",
    path: ["address"],
  });
