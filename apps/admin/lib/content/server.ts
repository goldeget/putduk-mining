import "server-only";
import { requireAdminCommand } from "../auth/principal";
import { createAdminServiceClient } from "../supabase/service";
import type { ContentDependencies } from "./handler";

export const contentDependencies: ContentDependencies = {
  authorize: requireAdminCommand,
  async rpc(name, args) {
    const { data, error } = await createAdminServiceClient().rpc(name, args);
    return { data, error };
  },
};
