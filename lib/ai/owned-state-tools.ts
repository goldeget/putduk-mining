import "server-only";
import { z } from "zod";
import type { VerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { formatProductDateTime } from "@/lib/i18n/date-time";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";
import {
  parseMiningServerDisplay,
  formatMiningMicroKrw,
} from "@/lib/product/mining-server-display";
import { readMemberSceneBinding } from "@/lib/product/read-member-scene-binding.server";
import { readOwnAiQuota } from "./member-usage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
const won = (value: string) =>
  formatAtomicAmount(value, "KRW").replace(/\sKRW$/, "원");

export async function assertOwnedToolIdentity(identity: VerifiedIdentity) {
  if (!z.uuid().safeParse(identity.userId).success)
    throw Error("AI_TOOL_OWNER_REQUIRED");
  const claims = await identity.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== identity.userId)
    throw Error("AI_TOOL_OWNER_CHANGED");
}

/** Use only approved public member facts. Never return the runtime DTO or formulas. */
export async function ownedMiningFacts(identity: VerifiedIdentity) {
  const [read, binding] = await Promise.all([
    readOwnMiningServerDisplay(identity),
    readMemberSceneBinding(identity),
  ]);
  const display = read.error ? null : parseMiningServerDisplay(read.data);
  const parts: string[] = [];
  if (display?.available) {
    parts.push(
      display.eligible_principal_micro_krw === null
        ? "현재 채굴 원금은 확인할 수 없어요."
        : `확인된 채굴 원금은 ${formatMiningMicroKrw(display.eligible_principal_micro_krw)}이에요.`,
    );
    parts.push(
      display.tier_code === null
        ? "현재 등급은 확인할 수 없어요."
        : `현재 등급 코드는 ${display.tier_code}이며 ${display.tier_activated ? "적용 중" : "적용 전"}이에요.`,
    );
    const runtime = display.funded_runtime;
    if (runtime) {
      parts.push(
        `확정된 누적 채굴 보상은 ${won(runtime.committed_reward_total_atomic)}이에요. 기록 시각은 ${formatProductDateTime(runtime.accepted_cursor_at)}이에요.`,
      );
      if (runtime.schema_version === 2)
        parts.push(
          `서버가 확인한 채굴 실행은 ${runtime.status === "ACTIVE" ? "진행 중" : "중단 상태"}이에요. 확인 시각은 ${formatProductDateTime(runtime.evaluated_at)}이에요.`,
        );
    }
  } else parts.push("현재 원금과 등급 정보는 확인할 수 없어요.");
  if (binding.state === "ready") {
    parts.push(
      `확인된 상품 배분 선택은 ${binding.products.map((p) => p.nameKo).join(", ")}이에요. 이 선택 기록만으로 실제 상품 이용 자격이나 현재 채굴 실행을 확정할 수는 없어요.`,
    );
  } else if (binding.state === "empty") {
    parts.push(
      "확인된 상품 배분 선택 기록이 없어요. 실제 이용 자격은 이 기록만으로 판단하지 않아요.",
    );
  } else parts.push("선택한 상품 기록은 지금 확인할 수 없어요.");
  return parts.join("\n");
}

const atomic = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .nullable();
const sourceSchema = z.object({
  schema_version: z.literal(2),
  coverage: z.enum(["COMPLETE", "UNRESOLVED"]),
  eligible_principal_atomic: atomic,
  held_principal_atomic: atomic,
  recovered_principal_atomic: atomic,
});
export async function ownedPrincipalFacts(identity: VerifiedIdentity) {
  const read = await createSupabaseAdminClient()
    .from("money_source_summaries")
    .select(
      "schema_version,coverage,eligible_principal_atomic,held_principal_atomic,recovered_principal_atomic",
    )
    .eq("user_id", identity.userId)
    .maybeSingle();
  const parsed = sourceSchema.safeParse(read.data);
  if (read.error || !parsed.success || parsed.data.coverage !== "COMPLETE")
    return "원금 기록을 모두 확인하지 못했어요. 원금 금액이나 회수 상태는 추정하지 않아요.";
  const row = parsed.data;
  const amount = (value: string | null) =>
    value === null ? "확인할 수 없어요" : won(value);
  return `확인된 유지 원금 ${amount(row.eligible_principal_atomic)}, 보류 원금 ${amount(row.held_principal_atomic)}, 회수된 원금 ${amount(row.recovered_principal_atomic)}이에요.`;
}

/** Principal source is proven through owner-bound immutable holds/releases.
 * Do not infer source from a status or fabricate a nonexistent source_kind. */
export async function ownedPrincipalCancellationFacts(
  identity: VerifiedIdentity,
) {
  const read = await identity.supabase
    .from("withdrawal_requests")
    .select(
      "status,hold_ledger_transaction_id,release_ledger_transaction_id,hold_released_at",
    )
    .eq("user_id", identity.userId)
    .eq("status", "CANCELLED")
    .order("requested_at", { ascending: false })
    .limit(20);
  const rowSchema = z.object({
    status: z.literal("CANCELLED"),
    hold_ledger_transaction_id: z.uuid().nullable(),
    release_ledger_transaction_id: z.uuid().nullable(),
    hold_released_at: z.iso.datetime({ offset: true }).nullable(),
  });
  const parsed = rowSchema.array().safeParse(read.data);
  if (read.error || !parsed.success)
    return "원금 회수 취소 기록은 지금 확인할 수 없어요.";
  const admin = createSupabaseAdminClient();
  let verified = 0;
  for (const row of parsed.data) {
    if (
      !row.hold_ledger_transaction_id ||
      !row.release_ledger_transaction_id ||
      !row.hold_released_at
    )
      continue;
    const [allocations, releases] = await Promise.all([
      admin
        .from("funding_principal_recovery_allocations")
        .select("effective_at")
        .eq("user_id", identity.userId)
        .eq("hold_ledger_transaction_id", row.hold_ledger_transaction_id)
        .limit(1),
      admin
        .from("funding_principal_recovery_releases")
        .select("effective_at")
        .eq("user_id", identity.userId)
        .eq("hold_ledger_transaction_id", row.hold_ledger_transaction_id)
        .eq("release_ledger_transaction_id", row.release_ledger_transaction_id)
        .limit(1),
    ]);
    if (allocations.error || releases.error)
      return "원금 회수 취소 기록은 지금 확인할 수 없어요.";
    const times = z
      .object({ effective_at: z.iso.datetime({ offset: true }) })
      .array();
    const a = times.safeParse(allocations.data),
      r = times.safeParse(releases.data);
    if (!a.success || !r.success)
      return "원금 회수 취소 기록은 지금 확인할 수 없어요.";
    if (
      a.data.length &&
      r.data.length &&
      r.data[0]?.effective_at === row.hold_released_at
    )
      verified++;
  }
  return `최근 취소된 출금 요청 ${parsed.data.length}개 범위에서 원금 회수 취소와 보류 해제 기록이 일치하는 요청은 ${verified}개예요. 이 범위 밖의 기록은 확인하지 않았어요.`;
}

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
