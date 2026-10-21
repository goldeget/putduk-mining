/** Native approved category identifiers. This module has no runtime dependencies. */
export const productCategories = [
  "KR_STOCK",
  "US_STOCK",
  "ETF",
  "GOLD",
  "SILVER",
  "CRYPTO",
] as const;

export type ProductCategory = (typeof productCategories)[number];
