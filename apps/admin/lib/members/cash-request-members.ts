import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { createAdminServiceClient } from "@/lib/supabase/service";
export type CashRequestMembers = {
  allowed: boolean;
  failed: boolean;
  members: ReadonlyMap<string, { name: string; loginId: string }>;
};
export async function loadCashRequestMembers(
  principal: AdminPrincipal,
  userIds: readonly string[],
): Promise<CashRequestMembers> {
  const members = new Map<string, { name: string; loginId: string }>();
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    return { allowed: false, failed: false, members };
  const ids = [...new Set(userIds)];
  if (!ids.length) return { allowed: true, failed: false, members };
  if (
    ids.length > 100 ||
    ids.some((id) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
  )
    return { allowed: true, failed: true, members };
  try {
    const db = createAdminServiceClient();
    const audit = await db
      .from("audit_logs")
      .insert({
        actor_user_id: principal.userId,
        actor_role: principal.role,
        action: "CASH_REQUEST_MEMBER_VIEW",
        target_type: "USER",
        target_id: "cash-request-owners",
        reason: "입출금 신청 회원 이름과 가입 아이디 확인",
        request_id: randomUUID(),
        metadata: { fields: ["legal_name", "login_id"], members: ids.length },
      });
    if (audit.error) return { allowed: true, failed: true, members };
    const result = await db
      .from("user_identity_profiles")
      .select("user_id,legal_name,login_id")
      .in("user_id", ids);
    if (result.error) return { allowed: true, failed: true, members };
    for (const row of result.data ?? [])
      if (
        ids.includes(row.user_id) &&
        typeof row.legal_name === "string" &&
        typeof row.login_id === "string"
      )
        members.set(row.user_id, {
          name: row.legal_name,
          loginId: row.login_id,
        });
    return { allowed: true, failed: false, members };
  } catch {
    return { allowed: true, failed: true, members };
  }
}
