import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { readSafeModeDecision } from "./app-guard";
import type { AppGuardedSafeModeComponent } from "./app-guard";

export type ComponentActiveResult =
  { ok: true } | { ok: false; reason: "PAUSED" | "UNAVAILABLE" };

/**
 * DB의 app_private.assert_not_safe_mode와 같은 조건으로 서버에서 확인한다.
 * 읽기에 실패하면 허용하지 않는다(UNAVAILABLE).
 * client와 now는 테스트에서만 바꾼다.
 */
export async function assertComponentActive(
  component: AppGuardedSafeModeComponent,
  options: { client?: unknown; now?: Date } = {},
): Promise<ComponentActiveResult> {
  let client: unknown;
  try {
    client = options.client ?? createSupabaseAdminClient();
  } catch {
    return { ok: false, reason: "UNAVAILABLE" };
  }
  const decision = await readSafeModeDecision(
    client,
    component,
    options.now ?? new Date(),
  );
  if (decision === "ACTIVE") return { ok: true };
  return {
    ok: false,
    reason: decision === "PAUSED" ? "PAUSED" : "UNAVAILABLE",
  };
}
