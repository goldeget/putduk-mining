import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ offset: true });
export const catalogOperationSchema = z.enum(["PREVIEW", "APPROVE", "PUBLISH"]);
export const catalogCommandSchema = z
  .object({
    operation: catalogOperationSchema,
    catalogId: z.uuid(),
    expectedRevision: z.uuid().nullable(),
    expectedDigest: digest,
    publishAt: instant,
    reason: z.string().trim().min(10).max(500),
    stepUpToken: z.string().min(16).max(512),
    confirmation: z.literal("CONFIRM_PRODUCT_CATALOG"),
  })
  .strict();
export const catalogReceiptSchema = z
  .object({
    catalogId: z.uuid(),
    revisionId: z.uuid(),
    revision: z.number().int().min(1).max(3),
    state: z.enum(["PREVIEWED", "APPROVED", "PUBLISHED"]),
    snapshotDigest: digest,
    publishAt: instant,
  })
  .strict();
const source = z.object({
  name: z.string().min(1),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }),
  accessed_on: z.string().optional(),
  snapshot_on: z.string().optional(),
  purpose: z.string().optional(),
});
const product = z.object({
  id: z.uuid(),
  code: z.string(),
  nameKo: z.string(),
  nameEn: z.string(),
  descriptionKo: z.string(),
  category: z.string(),
  displayOrder: z.number().int(),
});
export const catalogReviewSchema = z.object({
  catalogId: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "APPROVED", "PUBLISHED", "RETIRED"]),
  snapshotDate: z.string(),
  methodology: z.string(),
  sources: z.array(source),
  products: z.array(product),
  sourceDigest: digest,
  expectedDigest: digest,
  latestReceipt: catalogReceiptSchema.nullable(),
  supported: z.boolean(),
});
export const catalogStateSchema = z.object({
  schemaVersion: z.literal(1),
  serverNow: instant,
  catalogs: z.array(
    z.object({ id: z.uuid(), version: z.number().int(), status: z.string() }),
  ),
  selected: catalogReviewSchema.nullable(),
});
export type CatalogCommandInput = z.infer<typeof catalogCommandSchema>;
export type CatalogReceipt = z.infer<typeof catalogReceiptSchema>;
export type CatalogState = z.infer<typeof catalogStateSchema>;

/** Date.parse truncates SQL microseconds; preserve the full instant for receipts. */
export function catalogSameInstant(left: string, right: string) {
  function microseconds(value: string) {
    const fraction =
      /\.([0-9]+)(?:Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value)?.[1] ?? "";
    const milliseconds = Date.parse(value);
    if (
      !instant.safeParse(value).success ||
      !Number.isSafeInteger(milliseconds) ||
      fraction.length > 6
    )
      throw new Error("CATALOG_TIMESTAMP_UNCONFIRMED");
    return (
      BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3))
    );
  }
  return microseconds(left) === microseconds(right);
}
