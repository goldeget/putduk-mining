import { z } from "zod";

export const allocationProductSchema = z
  .object({
    productId: z.uuid(),
    allocationBps: z
      .string()
      .regex(/^[1-9][0-9]{0,4}$/)
      .refine((value) => BigInt(value) <= 10000n),
  })
  .strict();
export const allocationCommandSchema = z
  .object({
    catalogId: z.uuid(),
    catalogDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expectedRevision: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .max(19)
      .refine((value) => BigInt(value) < 9223372036854775807n),
    products: z.array(allocationProductSchema).max(128),
    confirmation: z.literal("CONFIRM_FUNDING_ALLOCATION"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.products.map((item) => item.productId)).size !==
      value.products.length
    )
      context.addIssue({
        code: "custom",
        message: "ALLOCATION_DUPLICATE_PRODUCT",
      });
    if (
      value.products.reduce(
        (sum, item) => sum + BigInt(item.allocationBps),
        0n,
      ) > 10000n
    )
      context.addIssue({
        code: "custom",
        message: "ALLOCATION_LIMIT_EXCEEDED",
      });
  });
export const allocationStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^(0|[1-9][0-9]*)$/),
  allocationId: z.uuid().nullable(),
  catalogId: z.uuid().nullable(),
  catalogDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  effectiveAt: z.iso.datetime({ offset: true }).nullable(),
  products: z.array(allocationProductSchema),
  availableProducts: z.array(
    z.object({
      productId: z.uuid(),
      nameKo: z.string(),
      available: z.boolean(),
    }),
  ),
  currentCatalog: z
    .object({ id: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/) })
    .nullable(),
  runtimeReady: z.boolean(),
});
export const allocationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    allocationId: z.uuid(),
    revision: z.string().regex(/^[1-9][0-9]*$/),
    catalogId: z.uuid(),
    catalogDigest: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveAt: z.iso.datetime({ offset: true }),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    products: z.array(allocationProductSchema),
    transitionId: z.uuid(),
  })
  .strict();
export type AllocationState = z.infer<typeof allocationStateSchema>;
