import { z } from "zod";
import { withdrawalInstantMicros } from "./principal-withdrawal-read";

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const networkSchema = z.enum(["TRC20", "ERC20", "BEP20"]);
const maskedCrypto = z
  .strictObject({ network: networkSchema, displayHint: z.string() })
  .refine((value) => {
    const pattern =
      value.network === "TRC20"
        ? /^TRC20 T[1-9A-HJ-NP-Za-km-z]{5}…[1-9A-HJ-NP-Za-km-z]{6}$/
        : /^(ERC20|BEP20) 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{6}$/;
    return (
      pattern.test(value.displayHint) &&
      value.displayHint.startsWith(value.network + " ")
    );
  });

/** Manual USDT send against KRW principal. No estimated/quoted USDT amount exists. */
export const principalCryptoWithdrawalReadSchema = z.discriminatedUnion(
  "available",
  [
    z.strictObject({
      schemaVersion: z.literal(1),
      available: z.literal(false),
    }),
    z.strictObject({
      schemaVersion: z.literal(1),
      available: z.literal(true),
      ownerId: z.string().uuid(),
      method: z.literal("USDT_ADDRESS"),
      evaluatedAt: z.string().datetime({ offset: true, precision: 6 }),
      eligiblePrincipalKrw: atomic,
      heldPrincipalKrw: atomic,
      walletAvailableKrw: atomic,
      stateRevision: atomic,
      conditionRevision: atomic,
      allocationBps: atomic.refine((value) => BigInt(value) <= 10000n),
      policy: z.strictObject({
        id: z.string().uuid(),
        version: z.number().int().positive().refine(Number.isSafeInteger),
        minimumAmountKrw: atomic,
        feeKrw: z.literal("0"),
      }),
      destinations: z
        .array(maskedCrypto.safeExtend({ id: z.string().uuid() }))
        .max(100),
    }),
  ],
);
export type PrincipalCryptoWithdrawalRead = z.infer<
  typeof principalCryptoWithdrawalReadSchema
>;
export const unavailablePrincipalCryptoWithdrawalRead: PrincipalCryptoWithdrawalRead =
  Object.freeze({ schemaVersion: 1, available: false });

export function readMaskedCryptoHint(hint: unknown) {
  if (typeof hint !== "string") return null;
  const network = networkSchema.safeParse(hint.split(" ")[0]);
  if (!network.success) return null;
  const parsed = maskedCrypto.safeParse({
    network: network.data,
    displayHint: hint,
  });
  return parsed.success ? parsed.data : null;
}
export function parsePrincipalCryptoWithdrawalRead(
  value: unknown,
  ownerId: string,
): PrincipalCryptoWithdrawalRead | null {
  const parsed = principalCryptoWithdrawalReadSchema.safeParse(value);
  return parsed.success &&
    (!parsed.data.available ||
      (parsed.data.ownerId === ownerId &&
        withdrawalInstantMicros(parsed.data.evaluatedAt) !== null))
    ? parsed.data
    : null;
}
