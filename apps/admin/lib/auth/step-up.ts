import "server-only";

import {
  ADMIN_STEP_UP_TTL_SECONDS,
  hashAdminToken,
  issueOpaqueAdminToken,
} from "@/lib/auth/session";
import { createAdminServiceClient } from "@/lib/supabase/service";

export async function issueAdminStepUpGrant(input: {
  adminSessionId: string;
  userId: string;
  commandFamily: string;
}): Promise<{ grantId: string; token: string } | null> {
  const token = issueOpaqueAdminToken();
  const service = createAdminServiceClient();
  const { data, error } = await service.rpc("issue_admin_step_up", {
    p_admin_session_id: input.adminSessionId,
    p_user_id: input.userId,
    p_command_family: input.commandFamily,
    p_token: token,
    p_ttl_seconds: ADMIN_STEP_UP_TTL_SECONDS,
  });

  if (error || typeof data !== "string") {
    return null;
  }

  return { grantId: data, token };
}

export async function consumeAdminStepUpGrant(input: {
  userId: string;
  adminSessionId: string;
  token: string;
  commandFamily: string;
  requestId: string;
}): Promise<boolean> {
  const service = createAdminServiceClient();
  const { error } = await service.rpc("consume_admin_step_up", {
    p_user_id: input.userId,
    p_admin_session_id: input.adminSessionId,
    p_token: input.token,
    p_command_family: input.commandFamily,
    p_request_id: input.requestId,
  });
  return !error;
}

export function peekStepUpTokenHash(token: string): string {
  return hashAdminToken(token);
}
