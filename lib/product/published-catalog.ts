import "server-only";

import {
  presentPublishedCatalogRead,
  type PublishedCatalogRead,
} from "@/domain/products/published-catalog";
import { getVerifiedIdentity } from "@/lib/auth/session";

// A single RLS read preserves the immutable published snapshot and its children.
// Never select rule_payload, display_profile, methodology or private source maps.
const publishedCatalogProjection =
  "id,version,status,snapshot_date,source_references,content_digest,approved_by,approved_at,published_at,created_at," +
  "mining_products(id,code,slug,category,name_ko,name_en,description_ko,display_order,is_featured,trial_available,created_at," +
  "product_availability(id,status,available_from,available_to,segment_key,created_at))";

export async function getPublishedCatalog(): Promise<PublishedCatalogRead> {
  const observedAt = new Date().toISOString();
  try {
    const identity = await getVerifiedIdentity();
    if (!identity) {
      return {
        state: "unauthenticated",
        catalog: null,
        products: [],
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
    return presentPublishedCatalogRead(data, error, observedAt);
  } catch {
    return presentPublishedCatalogRead(null, true, observedAt);
  }
}
