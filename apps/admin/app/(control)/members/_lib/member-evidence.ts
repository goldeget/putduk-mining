import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ADMIN_MEMBER_MINING_COUNT_READ 호출자.
 * Member 360 "채굴 · 정산" 카드용 head count만 수행한다.
 * INSERT/UPDATE/DELETE를 포함하지 않는다.
 */
export async function countMemberMiningSessions(
  db: SupabaseClient,
  userId: string,
) {
  return db
    .from("mining_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
}

export {
  anyMemberCountFailed,
  memberCountLabel,
  type MemberCountResult,
} from "./member-evidence-labels";
