import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminServiceClient } from "@/lib/supabase/service";

export async function recordAdminSecurityEvent(input: {
  eventType: string;
  userId: string | null;
  userAgent?: string | null;
}): Promise<boolean> {
  const { error } = await createAdminServiceClient()
    .from("security_events")
    .insert({
      user_id: input.userId,
      event_type: input.eventType,
      trusted_client_ip: null,
      ip_source: "NONE",
      user_agent: input.userAgent?.slice(0, 500) ?? null,
      device_context: { surface: "admin_control_plane" },
      risk_score: null,
      request_id: randomUUID(),
    });
  return !error;
}
