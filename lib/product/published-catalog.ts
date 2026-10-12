import "server-only";

import {
  presentPublishedCatalogRead,
  type PublishedCatalogRead,
} from "@/domain/products/published-catalog";
import { getVerifiedIdentity } from "@/lib/auth/session";
import {
  presentServerCatalogRead,
  type ServerCatalogRead,
} from "@/domain/products/catalog-server";

// A single RLS read preserves the immutable published snapshot and its children.
// Never select rule_payload, display_profile, methodology or private source maps.
const publishedCatalogProjection =
  "id,version,status,snapshot_date,source_references,content_digest,approved_by,approved_at,published_at,created_at," +
  "mining_products(id,code,slug,category,name_ko,name_en,description_ko,display_order,is_featured,trial_available,created_at," +
  "product_availability(id,status,available_from,available_to,segment_key,created_at))";

async function readPublishedCatalogSnapshot() {
  const observedAt = new Date().toISOString();
  try {
    const identity = await getVerifiedIdentity();
    if (!identity) {
      return {
        unauthenticated: true,
        data: null,
        error: null,
        observedAt,
      };
    }
    const { data, error } = await identity.supabase
      .from("product_catalog_versions")
      .select(publishedCatalogProjection)
      .eq("status", "PUBLISHED")
      .lte("published_at", observedAt)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    // A malformed latest version is an error, never an older-version fallback.
    return { unauthenticated: false, data, error, observedAt };
  } catch {
    return { unauthenticated: false, data: null, error: true, observedAt };
  }
}

export async function getPublishedCatalog(): Promise<PublishedCatalogRead> {
  const read = await readPublishedCatalogSnapshot();
  if (read.unauthenticated) {
    return {
      state: "unauthenticated",
      catalog: null,
      products: [],
      observedAt: read.observedAt,
    };
  }
  return presentPublishedCatalogRead(read.data, read.error, read.observedAt);
}

export async function getServerPublishedCatalog(): Promise<ServerCatalogRead> {
  const read = await readPublishedCatalogSnapshot();
  if (read.unauthenticated) {
    return {
      state: "unauthenticated",
      catalog: null,
      products: [],
      observedAt: read.observedAt,
    };
  }
  return presentServerCatalogRead(read.data, read.error, read.observedAt);
}
