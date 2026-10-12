import { z } from "zod";

import {
  presentCatalogReadForCategories,
  productCategories,
  type CatalogReadForCategory,
} from "./published-catalog";

export const serverProductCategories = [
  "KR_STOCK",
  "US_STOCK",
  "ETF",
  "GOLD",
  "SILVER",
  "CRYPTO",
] as const;
export const serverProductCategorySchema = z.enum(serverProductCategories);
export type ServerProductCategory = (typeof serverProductCategories)[number];

type CanonicalCatalogRead = CatalogReadForCategory<ServerProductCategory>;
export type ServerCatalogRead =
  | (Extract<CanonicalCatalogRead, { state: "loaded" }> & {
      legacyUi: {
        state: "READY" | "UI_PENDING";
        pendingProductIds: string[];
      };
    })
  | Exclude<CanonicalCatalogRead, { state: "loaded" }>;

/** Full approved snapshot; UI compatibility never drops or reclassifies a product. */
export function presentServerCatalogRead(
  data: unknown,
  error: unknown,
  observedAt: string,
): ServerCatalogRead {
  const read = presentCatalogReadForCategories(
    data,
    error,
    observedAt,
    serverProductCategories,
  );
  if (read.state !== "loaded") return read;
  const pendingProductIds = read.products
    .filter(
      (product) =>
        !productCategories.some((category) => category === product.category),
    )
    .map((product) => product.id);
  return {
    ...read,
    legacyUi: {
      state: pendingProductIds.length ? "UI_PENDING" : "READY",
      pendingProductIds,
    },
  };
}
