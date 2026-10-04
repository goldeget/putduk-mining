import type { Route } from "next";
import { redirect } from "next/navigation";

import { PublishedCatalogView } from "@/components/product/published-catalog-view";
import { requirePageUser } from "@/lib/auth/session";
import {
  buildLoginPath,
  safeProtectedReturnPath,
} from "@/lib/auth/return-path";
import { getPublishedCatalog } from "@/lib/product/published-catalog";

export default async function ProductsPage() {
  await requirePageUser("/products");
  const read = await getPublishedCatalog();
  if (read.state === "unauthenticated") {
    redirect(buildLoginPath(safeProtectedReturnPath("/products")) as Route);
  }
  return <PublishedCatalogView read={read} />;
}
