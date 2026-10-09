import "server-only";
import { requireAdminCommand, type AdminPrincipal } from "../auth/principal";
import { createAdminServiceClient } from "../supabase/service";
import { readCatalogState, type CatalogDependencies } from "./handler";

export const catalogDependencies: CatalogDependencies = {
  authorize: requireAdminCommand,
  async rpc(name, args) {
    const { data, error } = await createAdminServiceClient().rpc(name, args);
    return { data, error };
  },
};
export async function loadCatalogReview(
  principal: AdminPrincipal,
  catalogId: string | null,
) {
  try {
    return {
      ok: true as const,
      state: await readCatalogState(catalogDependencies, principal, catalogId),
    };
  } catch {
    return { ok: false as const };
  }
}
