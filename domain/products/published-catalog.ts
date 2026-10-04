import { z } from "zod";

export const productCategories = [
  "KR_STOCK",
  "US_STOCK",
  "GOLD",
  "SILVER",
  "CRYPTO",
] as const;

export type ProductCategory = (typeof productCategories)[number];

export type PublishedCatalogSource = {
  name: string;
  url: string;
  accessedOn: string | null;
  snapshotOn: string | null;
};

export type PublishedCatalogEvidence = {
  id: string;
  version: number;
  snapshotDate: string;
  createdAt: string;
  approvedAt: string;
  publishedAt: string;
  contentDigest: string;
  sources: PublishedCatalogSource[];
};

export type PublishedProductAvailability = {
  state: "available" | "scheduled" | "paused" | "retired" | "unavailable";
  availableFrom: string | null;
  availableTo: string | null;
  recordedAt: string | null;
};

export type PublishedCatalogProduct = {
  id: string;
  code: string;
  slug: string;
  category: ProductCategory;
  nameKo: string;
  nameEn: string;
  descriptionKo: string;
  displayOrder: number;
  isFeatured: boolean;
  trialAvailable: boolean;
  createdAt: string;
  availability: PublishedProductAvailability;
};

type NoCatalog = {
  catalog: null;
  products: [];
  observedAt: string;
};

export type PublishedCatalogRead =
  | {
      state: "loaded";
      catalog: PublishedCatalogEvidence;
      products: PublishedCatalogProduct[];
      observedAt: string;
    }
  | (NoCatalog & { state: "empty" | "unauthenticated" })
  | (NoCatalog & {
      state: "error";
      reason: "query_failed" | "invalid_catalog" | "invalid_products";
    });

const timestamp = z.iso.datetime({ offset: true });
const nonblank = z.string().trim().min(1);
const positivePostgresInteger = z.number().int().positive().max(2_147_483_647);
const sourceSchema = z.object({
  name: nonblank,
  url: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }),
  accessed_on: z.iso.date().optional(),
  snapshot_on: z.iso.date().optional(),
});

const catalogSchema = z.object({
  id: z.uuid(),
  version: positivePostgresInteger,
  status: z.literal("PUBLISHED"),
  snapshot_date: z.iso.date(),
  source_references: z.array(sourceSchema).min(1),
  content_digest: z.string().regex(/^[a-f0-9]{64}$/),
  // Validate the stored approval evidence, but never expose an operator UUID.
  approved_by: z.uuid(),
  approved_at: timestamp,
  published_at: timestamp,
  created_at: timestamp,
  mining_products: z.unknown(),
});

const availabilitySchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["SCHEDULED", "AVAILABLE", "PAUSED", "RETIRED"]),
    available_from: timestamp,
    available_to: timestamp.nullable(),
    segment_key: nonblank.nullable(),
    created_at: timestamp,
  })
  .refine(
    (row) =>
      row.available_to === null ||
      Date.parse(row.available_to) > Date.parse(row.available_from),
  );

const productSchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,31}$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(productCategories),
  name_ko: nonblank,
  name_en: nonblank,
  description_ko: nonblank,
  display_order: positivePostgresInteger,
  is_featured: z.boolean(),
  trial_available: z.boolean(),
  created_at: timestamp,
  product_availability: z.array(availabilitySchema),
});

type AvailabilityRow = z.infer<typeof availabilitySchema>;

const unavailable: PublishedProductAvailability = {
  state: "unavailable",
  availableFrom: null,
  availableTo: null,
  recordedAt: null,
};

function presentAvailability(
  rows: AvailabilityRow[],
  now: number,
): PublishedProductAvailability | null {
  // No segment membership resolver exists. Do not infer member eligibility.
  const general = rows.filter((row) => row.segment_key === null);
  const active = general.filter(
    (row) =>
      Date.parse(row.available_from) <= now &&
      (row.available_to === null || Date.parse(row.available_to) > now),
  );
  if (active.length > 1) return null;

  const current = active[0];
  const next = general
    .filter(
      (row) =>
        Date.parse(row.available_from) > now &&
        ["AVAILABLE", "SCHEDULED"].includes(row.status),
    )
    .sort(
      (left, right) =>
        Date.parse(left.available_from) - Date.parse(right.available_from),
    )[0];
  const row = current ?? next;
  if (!row) return { ...unavailable };

  return {
    state: current
      ? (current.status.toLowerCase() as Exclude<
          PublishedProductAvailability["state"],
          "unavailable"
        >)
      : "scheduled",
    availableFrom: row.available_from,
    availableTo: row.available_to,
    recordedAt: row.created_at,
  };
}

/** A read projection only; catalog availability is not a mining selection. */
export function presentPublishedCatalogRead(
  data: unknown,
  error: unknown,
  observedAt: string,
): PublishedCatalogRead {
  const none = { catalog: null, products: [] as [], observedAt };
  if (error) return { ...none, state: "error", reason: "query_failed" };
  if (!timestamp.safeParse(observedAt).success) {
    return { ...none, state: "error", reason: "invalid_catalog" };
  }
  if (data === null) return { ...none, state: "empty" };
  const parsed = catalogSchema.safeParse(data);
  if (!parsed.success) {
    return { ...none, state: "error", reason: "invalid_catalog" };
  }
  const catalog = parsed.data;
  const now = Date.parse(observedAt);
  if (
    Date.parse(catalog.created_at) > Date.parse(catalog.approved_at) ||
    Date.parse(catalog.approved_at) > Date.parse(catalog.published_at) ||
    Date.parse(catalog.published_at) > now
  ) {
    return { ...none, state: "error", reason: "invalid_catalog" };
  }

  const parsedProducts = z
    .array(productSchema)
    .safeParse(catalog.mining_products);
  if (!parsedProducts.success) {
    return { ...none, state: "error", reason: "invalid_products" };
  }
  const rows = parsedProducts.data;
  for (const key of ["id", "code", "slug", "display_order"] as const) {
    if (new Set(rows.map((row) => row[key])).size !== rows.length) {
      return { ...none, state: "error", reason: "invalid_products" };
    }
  }
  const products: PublishedCatalogProduct[] = [];
  for (const row of rows) {
    const availability = presentAvailability(row.product_availability, now);
    if (availability === null) {
      return { ...none, state: "error", reason: "invalid_products" };
    }
    products.push({
      id: row.id,
      code: row.code,
      slug: row.slug,
      category: row.category,
      nameKo: row.name_ko,
      nameEn: row.name_en,
      descriptionKo: row.description_ko,
      displayOrder: row.display_order,
      isFeatured: row.is_featured,
      trialAvailable: row.trial_available,
      createdAt: row.created_at,
      availability,
    });
  }
  return {
    state: "loaded",
    catalog: {
      id: catalog.id,
      version: catalog.version,
      snapshotDate: catalog.snapshot_date,
      createdAt: catalog.created_at,
      approvedAt: catalog.approved_at,
      publishedAt: catalog.published_at,
      contentDigest: catalog.content_digest,
      sources: catalog.source_references.map((source) => ({
        name: source.name,
        url: source.url,
        accessedOn: source.accessed_on ?? null,
        snapshotOn: source.snapshot_on ?? null,
      })),
    },
    products: products.sort(
      (left, right) => left.displayOrder - right.displayOrder,
    ),
    observedAt,
  };
}
