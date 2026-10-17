import { z } from "zod";

export type Manual195Original = {
  withdrawalId: string;
  requestedKrwAmount: string;
  actualUsdtAmount: string;
  network: "TRC20" | "ERC20" | "BEP20";
  fullPayoutConfirmed: true;
};

/** Test-only attestations. Unknown and legacy inputs are never normalized. */
export function manual195Evidence(original: Manual195Original) {
  const keys = [
    "withdrawalId",
    "requestedKrwAmount",
    "actualUsdtAmount",
    "network",
    "fullPayoutConfirmed",
  ];
  if (
    !original ||
    typeof original !== "object" ||
    Object.keys(original).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(original, key)) ||
    original.fullPayoutConfirmed !== true ||
    typeof original.withdrawalId !== "string" ||
    !z.uuid().safeParse(original.withdrawalId).success ||
    original.withdrawalId !== original.withdrawalId.toLowerCase() ||
    typeof original.requestedKrwAmount !== "string" ||
    !/^[1-9][0-9]{0,18}$/.test(original.requestedKrwAmount) ||
    BigInt(original.requestedKrwAmount) > 9223372036854775807n ||
    typeof original.actualUsdtAmount !== "string" ||
    !/^(0|[1-9][0-9]{0,31})([.][0-9]{0,5}[1-9])?$/.test(
      original.actualUsdtAmount,
    ) ||
    !/[1-9]/.test(original.actualUsdtAmount) ||
    !["TRC20", "ERC20", "BEP20"].includes(original.network)
  ) {
    throw new Error("EXPLICIT_CANONICAL_MANUAL_195_ATTESTATION_REQUIRED");
  }
  return Object.freeze({
    version: 1 as const,
    basis: "OPERATOR_MANUAL_FULL_PAYOUT" as const,
    withdrawalId: original.withdrawalId,
    requestedKrwAmount: original.requestedKrwAmount,
    actualUsdtAmount: original.actualUsdtAmount,
    network: original.network,
    feeKrw: "0" as const,
    fullPayoutConfirmed: true as const,
  });
}
