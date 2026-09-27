"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  mapRpcFailure,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";

const safeModeSchema = z.object({
  component: z.enum([
    "GLOBAL",
    "SIGNUP",
    "TRIAL",
    "NEW_MINING",
    "SETTLEMENT",
    "DEPOSIT",
    "WITHDRAWAL",
    "REFERRAL_PAYOUT",
    "EVENT_PAYOUT",
    "NOTIFICATION",
    "AI",
  ]),
  pause: z.enum(["true", "false"]),
  reason: z.string().trim().min(10).max(500),
  confirmation: z.literal("SAFE_MODE"),
});

export async function setSafeModeAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.SAFE_MODE,
    formData,
    ["SUPER_ADMIN", "ADMIN"],
  );
  if (!access.ok) return access.result;

  const parsed = safeModeSchema.safeParse({
    component: formData.get("component"),
    pause: formData.get("pause"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "안전 모드 입력값을 확인해 주세요.",
    };
  }

  const isPaused = parsed.data.pause === "true";
  const db = createAdminServiceClient();
  const { error } = await db.from("safe_mode_controls").upsert(
    {
      component: parsed.data.component,
      is_paused: isPaused,
      reason: parsed.data.reason,
      starts_at: new Date().toISOString(),
      changed_by: access.principal.userId,
      request_id: access.requestId,
    },
    { onConflict: "component" },
  );

  if (error) {
    return mapRpcFailure(error.message, "안전 모드를 저장하지 못했습니다.");
  }

  await db.from("audit_logs").insert({
    actor_user_id: access.principal.userId,
    actor_role: access.principal.role,
    action: isPaused ? "SAFE_MODE_ENABLED" : "SAFE_MODE_DISABLED",
    target_type: "SAFE_MODE",
    target_id: parsed.data.component,
    reason: parsed.data.reason,
    request_id: randomUUID(),
    metadata: { component: parsed.data.component, is_paused: isPaused },
  });

  return {
    ok: true,
    message: isPaused
      ? `${parsed.data.component} 기능을 잠시 멈췄습니다.`
      : `${parsed.data.component} 기능 제한을 해제했습니다.`,
  };
}
