import "server-only";

import { z } from "zod";

import { presentPublishedCatalogRead } from "@/domain/products/published-catalog";
import type { AllocationState } from "@/domain/products/allocation-command";
import type { VerifiedIdentity } from "@/lib/auth/session";
import { resolveCatalogProduct } from "@/lib/mining-scene/resolve-scene";
import type { ResolvedScene } from "@/lib/mining-scene/types";
import { readAllocation } from "@/lib/product/allocation-handler";

const catalogProjection =
  "id,version,status,snapshot_date,source_references,content_digest,approved_by,approved_at,published_at,created_at," +
  "mining_products(id,code,slug,category,name_ko,name_en,description_ko,display_order,is_featured,trial_available,created_at," +
  "product_availability(id,status,available_from,available_to,segment_key,created_at))";

type ClosedBinding = {
  schemaVersion: 1;
  scope: "CONFIRMED_ALLOCATION_ONLY";
  runtimeBinding: "UNCONFIRMED";
  products: [];
  state: "empty" | "unknown" | "stale" | "unavailable";
};

export type MemberSceneBindingRead =
  | ClosedBinding
  | {
      schemaVersion: 1;
      scope: "CONFIRMED_ALLOCATION_ONLY";
      runtimeBinding: "UNCONFIRMED";
      state: "ready";
      source: {
        allocationId: string;
        allocationRevision: string;
        effectiveAt: string;
        catalogId: string;
        catalogVersion: number;
        /** Publication receipt hash; different from the source content hash. */
        catalogPublicationDigest: string;
        catalogContentDigest: string;
        observedAt: string;
      };
      products: {
        productId: string;
        code: string;
        category: ResolvedScene["identity"]["category"];
        nameKo: string;
        allocationBps: string;
        scene: ResolvedScene;
        productComplete: false;
      }[];
    };

function closed(state: ClosedBinding["state"]): ClosedBinding {
  return {
    schemaVersion: 1,
    scope: "CONFIRMED_ALLOCATION_ONLY",
    runtimeBinding: "UNCONFIRMED",
    state,
    products: [],
  };
}

function sourceKey(state: AllocationState) {
  return JSON.stringify({
    revision: state.revision,
    allocationId: state.allocationId,
    catalogId: state.catalogId,
    catalogDigest: state.catalogDigest,
    effectiveAt: state.effectiveAt,
    products: state.products,
    currentCatalog: state.currentCatalog,
  });
}

function currentPublication(state: AllocationState) {
  return (
    state.catalogId !== null &&
    state.catalogDigest !== null &&
    state.currentCatalog?.id === state.catalogId &&
    state.currentCatalog.digest === state.catalogDigest
  );
}

async function matchesOwner(identity: VerifiedIdentity) {
  const { data, error } = await identity.supabase.auth.getClaims();
  return !error && data?.claims?.sub === identity.userId;
}

/**
 * Owner-JWT allocation READ plus its exact current published catalog. This is
 * selected-product presentation, never current-session or per-product accrual
 * proof. A changed read closes instead of borrowing a newer catalog/scene.
 */
export async function readMemberSceneBinding(
  identity: VerifiedIdentity,
): Promise<MemberSceneBindingRead> {
  try {
    if (
      !z.uuid().safeParse(identity.userId).success ||
      !(await matchesOwner(identity))
    )
      return closed("unknown");
    const first = await readAllocation(identity.supabase);
    if (first.products.length === 0) return closed("empty");
    if (
      !first.allocationId ||
      !first.effectiveAt ||
      BigInt(first.revision) <= 0n ||
      BigInt(first.revision) >= 9223372036854775807n ||
      first.products.length > 128 ||
      new Set(first.products.map((product) => product.productId)).size !==
        first.products.length ||
      first.products.reduce(
        (sum, product) => sum + BigInt(product.allocationBps),
        0n,
      ) > 10000n
    )
      return closed("unknown");
    if (!currentPublication(first)) return closed("stale");

    const { data, error } = await identity.supabase
      .from("product_catalog_versions")
      .select(catalogProjection)
      .eq("id", first.catalogId!)
      .eq("status", "PUBLISHED")
      .maybeSingle();
    if (error) return closed("unknown");
    if (data === null) return closed("unavailable");

    const second = await readAllocation(identity.supabase);
    if (!(await matchesOwner(identity))) return closed("unknown");
    if (sourceKey(first) !== sourceKey(second)) return closed("stale");
    const observedAt = new Date().toISOString();
    const catalog = presentPublishedCatalogRead(data, null, observedAt);
    if (catalog.state !== "loaded") return closed("unknown");
    if (
      catalog.catalog.id !== first.catalogId ||
      Date.parse(first.effectiveAt) > Date.parse(observedAt) ||
      Date.parse(catalog.catalog.publishedAt) > Date.parse(first.effectiveAt)
    )
      return closed("stale");

    const products: Extract<
      MemberSceneBindingRead,
      { state: "ready" }
    >["products"] = [];
    for (const selected of first.products) {
      const product = catalog.products.find(
        (row) => row.id === selected.productId,
      );
      if (!product || product.availability.state !== "available")
        return closed("unavailable");
      if (Date.parse(product.createdAt) > Date.parse(first.effectiveAt))
        return closed("stale");
      products.push({
        productId: product.id,
        code: product.code,
        category: product.category,
        nameKo: product.nameKo,
        allocationBps: selected.allocationBps,
        scene: resolveCatalogProduct({
          code: product.code,
          category: product.category,
        }),
        productComplete: false,
      });
    }
    return {
      schemaVersion: 1,
      scope: "CONFIRMED_ALLOCATION_ONLY",
      runtimeBinding: "UNCONFIRMED",
      state: "ready",
      source: {
        allocationId: first.allocationId,
        allocationRevision: first.revision,
        effectiveAt: first.effectiveAt,
        catalogId: catalog.catalog.id,
        catalogVersion: catalog.catalog.version,
        catalogPublicationDigest: first.catalogDigest!,
        catalogContentDigest: catalog.catalog.contentDigest,
        observedAt,
      },
      products,
    };
  } catch {
    return closed("unknown");
  }
}
