import "server-only";
import { z } from "zod";
import type { VerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { formatProductDateTime } from "@/lib/i18n/date-time";
import { readOwnAiQuota } from "./member-usage";

export async function assertOwnedToolIdentity(identity: VerifiedIdentity) {
  if (!z.uuid().safeParse(identity.userId).success)
    throw Error("AI_TOOL_OWNER_REQUIRED");
  const claims = await identity.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== identity.userId)
    throw Error("AI_TOOL_OWNER_CHANGED");
}

// ... mining/trial fact functions removed — monitoring platform uses workroom_accounts balance ...

export async function ownedAiQuotaFacts(identity: VerifiedIdentity, now: Date) {
  const env = getServerEnv();
  const observedAtMs = now.getTime();
  const [day, minute] = await Promise.all([
    readOwnAiQuota(identity.supabase, {
      userId: identity.userId,
      observedAtMs,
      windowMs: 86_400_000,
      limit: env.AI_MAX_REQUESTS_PER_DAY,
    }),
    readOwnAiQuota(identity.supabase, {
      userId: identity.userId,
      observedAtMs,
      windowMs: 60_000,
      limit: env.AI_MAX_REQUESTS_PER_MINUTE,
    }),
  ]);
  const next = [day.nextAvailableAt, minute.nextAvailableAt]
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1);
  return `최근 24시간 이용은 ${day.used}회 / ${day.limit}회, 최근 1분 이용은 ${minute.used}회 / ${minute.limit}회예요. ${next ? `다음 이용 가능 시각은 ${formatProductDateTime(next)}이에요.` : "현재 횟수 제한에 따른 대기 시간은 없어요."} 새 요청의 로그인 상태와 한도는 다시 확인해요.`;
}

/** Aggregate only. No transcript, private attempts, raw error or paid billing. */
export async function ownedCancelledAiFacts(identity: VerifiedIdentity) {
  const read = await identity.supabase
    .from("ai_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", identity.userId)
    .eq("status", "CANCELLED");
  if (
    read.error ||
    read.count === null ||
    !Number.isSafeInteger(read.count) ||
    read.count < 0
  )
    throw Error("AI_CANCELLED_HISTORY_UNAVAILABLE");
  return `본인 계정에 취소로 기록된 AI 요청은 ${read.count}개예요.`;
}
