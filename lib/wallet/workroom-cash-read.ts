import { z } from "zod";

const amount = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const workroomCashReadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  currency: z.literal("KRW"),
  source: z.literal("DIRECT_DEPOSIT"),
  availableKrw: amount,
  heldKrw: amount,
  depositedKrw: amount,
  withdrawnKrw: amount,
  ready: z.boolean(),
});
export type WorkroomCashRead = z.infer<typeof workroomCashReadSchema>;
