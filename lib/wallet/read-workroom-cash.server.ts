import "server-only";
import type { VerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  workroomCashReadSchema,
  type WorkroomCashRead,
} from "./workroom-cash-read";

export async function readWorkroomCash(
  identity: VerifiedIdentity,
): Promise<WorkroomCashRead | null> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "read_workroom_cash",
      { p_user_id: identity.userId },
    );
    if (error) return null;
    const result = workroomCashReadSchema.safeParse(data);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
