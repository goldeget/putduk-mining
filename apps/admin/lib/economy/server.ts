import "server-only";

import type { AdminPrincipal } from "../auth/principal";
import { requireAdminCommand } from "../auth/principal";
import { createAdminServiceClient } from "../supabase/service";
import { readEconomyState, type EconomyDependencies } from "./handler";
import { economyConsoleView } from "./state";

export const economyDependencies: EconomyDependencies = {
  authorize: requireAdminCommand,
  async rpc(name, args) {
    const { data, error } = await createAdminServiceClient().rpc(name, args);
    return { data, error };
  },
};

export async function loadEconomyConsole(
  principal: AdminPrincipal,
  policyVersion: string | null,
) {
  try {
    return {
      ok: true as const,
      view: economyConsoleView(
        await readEconomyState(economyDependencies, principal, policyVersion),
      ),
    };
  } catch {
    return { ok: false as const };
  }
}
