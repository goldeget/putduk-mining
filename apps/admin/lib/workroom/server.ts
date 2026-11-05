import "server-only";
import {
  getAdminIdentity,
  requireAdminCommand,
  type AdminPrincipal,
} from "../auth/principal";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
import { assertAndTouchAdminAppSession } from "../auth/session-registry";
import type { WorkroomDependencies } from "./handler";
export const workroomDependencies: WorkroomDependencies = {
  authorize: requireAdminCommand,
  async authorizeRead(request) {
    const identity = await getAdminIdentity();
    if (!identity) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
    if (
      !identity.role ||
      !HIGH_IMPACT_ROLES.includes(identity.role) ||
      identity.aal !== "aal2"
    )
      return { ok: false, status: 403, code: "ROLE_OR_MFA_REQUIRED" };
    const session = await assertAndTouchAdminAppSession({
      userId: identity.userId,
      authSessionId: identity.sessionId,
      userAgent: request.headers.get("user-agent"),
    });
    if (!session.ok) return { ok: false, status: 403, code: session.code };
    return {
      ok: true,
      principal: {
        ...identity,
        role: identity.role,
        adminSessionId: session.adminSessionId,
      },
    };
  },
  async invoke(principal, args) {
    // This client carries the verified user's JWT; SQL rechecks auth.uid/session/role.
    const { data, error } = await (principal as AdminPrincipal).supabase.rpc(
      "workroom_admin_command",
      args,
    );
    return { data, error };
  },
};
