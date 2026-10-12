import { z } from "zod";

const positiveKrwAtomic = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine(
    (value) =>
      /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
  );

const canonicalUsdtAmount = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,31})(\.[0-9]{0,5}[1-9])?$/)
  .refine((value) => /[1-9]/.test(value));

/**
 * An operator's manual full-payment confirmation, not an FX quote or proof
 * of bank/chain delivery. The DB binds this evidence to the original request
 * and registered destination before admitting a new external-send receipt.
 * Existing opaque/null receipt evidence must remain unchanged during replay.
 */
export const manualUsdtFullPayoutEvidenceSchema = z.strictObject({
  version: z.literal(1),
  basis: z.literal("OPERATOR_MANUAL_FULL_PAYOUT"),
  withdrawalId: z
    .string()
    .uuid()
    .refine((value) => value === value.toLowerCase()),
  requestedKrwAmount: positiveKrwAtomic,
  actualUsdtAmount: canonicalUsdtAmount,
  network: z.enum(["TRC20", "ERC20", "BEP20"]),
  feeKrw: z.literal("0"),
  fullPayoutConfirmed: z.literal(true),
});

export type ManualUsdtFullPayoutEvidence = z.infer<
  typeof manualUsdtFullPayoutEvidenceSchema
>;

/** Exact six-decimal normalization only; no exchange or rounding calculation. */
export function normalizeManualUsdtAmount(value: string): string | null {
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(value) || value.length > 128) {
    return null;
  }
  const [whole = "", fraction = ""] = value.split(".");
  const canonicalWhole = whole.replace(/^0+(?=[0-9])/, "");
  const canonicalFraction = fraction.replace(/0+$/, "");
  const canonical = canonicalFraction
    ? `${canonicalWhole}.${canonicalFraction}`
    : canonicalWhole;
  return canonicalUsdtAmount.safeParse(canonical).success ? canonical : null;
}

/** A pure contract check; DB originals remain the authoritative admission gate. */
export function parseManualUsdtFullPayoutEvidence(
  value: unknown,
  original: {
    withdrawalId: string;
    requestedKrwAmount: string;
    actualUsdtAmount: string;
    network: "TRC20" | "ERC20" | "BEP20";
  },
): ManualUsdtFullPayoutEvidence | null {
  const parsed = manualUsdtFullPayoutEvidenceSchema.safeParse(value);
  if (!parsed.success) return null;
  const evidence = parsed.data;
  if (
    evidence.withdrawalId.toLowerCase() !==
      original.withdrawalId.toLowerCase() ||
    evidence.requestedKrwAmount !== original.requestedKrwAmount ||
    evidence.network !== original.network ||
    evidence.actualUsdtAmount !==
      normalizeManualUsdtAmount(original.actualUsdtAmount)
  ) {
    return null;
  }
  return evidence;
}

const MANUAL_PAYOUT_FAILURES = [
  "USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED",
  "USDT_SEND_NETWORK_MISMATCH",
  "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_REQUIRED",
  "USDT_MANUAL_FULL_PAYOUT_EVIDENCE_INVALID",
  "USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH",
  "USDT_MANUAL_FULL_PAYOUT_AMOUNT_MISMATCH",
] as const;

export function manualUsdtPayoutFailure(message: string): {
  code: (typeof MANUAL_PAYOUT_FAILURES)[number];
  message: string;
} | null {
  const code = MANUAL_PAYOUT_FAILURES.find((candidate) =>
    message.includes(candidate),
  );
  if (!code) return null;
  const networkFailure =
    code === "USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED" ||
    code === "USDT_SEND_NETWORK_MISMATCH";
  return {
    code,
    message: networkFailure
      ? "등록된 출금 네트워크와 실제 송금 네트워크를 확인해 주세요. 원본을 확인할 수 없거나 서로 다르면 송금 기록과 완료 처리를 진행할 수 없습니다."
      : "요청 금액 전액을 수수료 없이 수동 송금한 확인 기록이 필요합니다. 원화 요청액과 실제 USDT 송금액을 확인해 주세요. 확인되지 않은 기존 기록은 다시 송금하지 말고 운영 검토로 처리해 주세요.",
  };
}
