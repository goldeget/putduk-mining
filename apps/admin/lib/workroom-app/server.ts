import "server-only";
import { workroomDependencies } from "../workroom/server";
import type { AdminPrincipal } from "../auth/principal";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
import type { AppDependencies } from "../../../../lib/workroom-app/handler";
import { getAdminEnv } from "../env";

export function adminAppDependencies(): AppDependencies {
  return {
    origin: new URL(getAdminEnv().ADMIN_APP_URL).origin,
    async authorize(request, write) {
      const access = write
        ? await workroomDependencies.authorize(request, HIGH_IMPACT_ROLES)
        : await workroomDependencies.authorizeRead(request);
      if (!access.ok) return access;
      return { ok: true, identity: access.principal };
    },
    async invoke(identity, operation, key, input) {
      const principal = identity as AdminPrincipal;
      return principal.supabase.rpc("workroom_app_admin", {
        p_operation: operation,
        p_request_key: key,
        p_input: input,
        p_actor: principal.userId,
        p_admin_session_id: principal.adminSessionId,
        p_auth_session_id: principal.sessionId,
        p_verified_aal: principal.aal,
      });
    },
  };
}
