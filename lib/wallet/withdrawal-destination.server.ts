import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

/** Shared by prepare and registration; never a competing client-side hash. */
export const withdrawalDestinationSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("KRW_BANK"),
      accountHolder: z.string().normalize("NFKC").trim().min(2).max(60),
      accountNumber: z
        .string()
        .trim()
        .regex(/^[0-9-]{6,32}$/)
        .transform((value) => value.replace(/-/g, ""))
        .pipe(z.string().regex(/^[0-9]{6,32}$/)),
      bankCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9_]{2,20}$/),
    })
    .strict(),
  z
    .object({
      method: z.literal("USDT_ADDRESS"),
      address: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{20,128}$/),
      network: z.enum(["TRC20", "ERC20", "BEP20"]),
    })
    .strict(),
]);

export type CanonicalWithdrawalDestination = z.infer<
  typeof withdrawalDestinationSchema
>;

export function withdrawalDestinationIdentity(
  destination: CanonicalWithdrawalDestination,
) {
  // Preserve the existing value_fingerprint algorithm and JSON field order.
  const sensitive =
    destination.method === "KRW_BANK"
      ? {
          accountHolder: destination.accountHolder,
          accountNumber: destination.accountNumber,
          bankCode: destination.bankCode,
        }
      : { address: destination.address, network: destination.network };
  return {
    sensitive,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(sensitive), "utf8")
      .digest("hex"),
    displayHint:
      destination.method === "KRW_BANK"
        ? `${destination.bankCode} ${"•".repeat(Math.max(0, destination.accountNumber.length - 4))}${destination.accountNumber.slice(-4)}`
        : `${destination.network} ${destination.address.slice(0, 6)}…${destination.address.slice(-6)}`,
  };
}
