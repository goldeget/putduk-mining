import { z } from "zod";

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const instant = z.string().datetime({ offset: true, precision: 6 });
export const principalWithdrawalSnapshotSchema = z.strictObject({
  method: z.enum(["KRW_BANK", "USDT_ADDRESS"]),
  amountKrw: z.string().regex(/^[1-9][0-9]{0,14}$/),
  policyId: z.string().uuid(),
  policyVersion: z.number().int().positive().refine(Number.isSafeInteger),
  destinationId: z.string().uuid(),
  destination: z.null(),
  confirmation: z.strictObject({
    version: z.literal(1),
    source: z.literal("PRINCIPAL"),
    confirmed: z.literal(true),
  }),
});
export type PrincipalWithdrawalSnapshot = Readonly<
  z.infer<typeof principalWithdrawalSnapshotSchema>
>;

/** Current read facts, never a reserved amount or a lock-bound execution preview. */
export const principalWithdrawalReadSchema = z.discriminatedUnion("available", [
  z.strictObject({ schemaVersion: z.literal(1), available: z.literal(false) }),
  z.strictObject({
    schemaVersion: z.literal(1),
    available: z.literal(true),
    ownerId: z.string().uuid(),
    evaluatedAt: instant,
    eligiblePrincipalKrw: atomic,
    heldPrincipalKrw: atomic,
    walletAvailableKrw: atomic,
    stateRevision: atomic,
    conditionRevision: atomic,
    allocationBps: atomic.refine((v) => BigInt(v) <= 10000n),
    policy: z.strictObject({
      id: z.string().uuid(),
      version: z.number().int().positive().refine(Number.isSafeInteger),
      minimumAmountKrw: atomic,
      feeKrw: z.literal("0"),
    }),
    destinations: z
      .array(
        z.strictObject({
          id: z.string().uuid(),
          displayHint: z.string().regex(/^[A-Z0-9_]{2,20} [•*]{2,28}[0-9]{4}$/),
        }),
      )
      .max(100),
  }),
]);
export type PrincipalWithdrawalRead = z.infer<
  typeof principalWithdrawalReadSchema
>;
export const unavailablePrincipalWithdrawalRead: PrincipalWithdrawalRead =
  Object.freeze({ schemaVersion: 1, available: false });

/** Compare supplied server timestamps exactly, including microseconds. */
export function withdrawalInstantMicros(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.([0-9]{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(
      value,
    );
  if (!match) return null;
  const seconds = Date.parse(match[1]! + match[3]!);
  return Number.isFinite(seconds)
    ? BigInt(seconds) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0")
    : null;
}

export function exactAtomicRead(value: unknown): string | null {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  return null;
}

/** A safe read belongs to the same verified owner as its recovery slot. */
export function parsePrincipalWithdrawalRead(
  value: unknown,
  ownerId: string,
): PrincipalWithdrawalRead | null {
  const parsed = principalWithdrawalReadSchema.safeParse(value);
  return parsed.success &&
    (!parsed.data.available || parsed.data.ownerId === ownerId)
    ? parsed.data
    : null;
}
