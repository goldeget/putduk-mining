import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AiScreenContext } from "@/domain/ai/chat";
import { activeMemberNotificationExpiryOr } from "@/domain/notifications/member-inbox";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { formatProductDateTime } from "@/lib/i18n/date-time";
import type { VerifiedIdentity } from "@/lib/auth/session";
import {
  assertOwnedToolIdentity,
  ownedAiQuotaFacts,
  ownedCancelledAiFacts,
} from "./owned-state-tools";

import { getAiToolFailureCopy } from "./orchestrator";
import type { AiToolName } from "./tools";

const atomicSchema = z
  .union([z.string().regex(/^\d+$/), z.number().int().safe().nonnegative()])
  .transform((value) => String(value));
const currencySchema = z.enum(["KRW", "USDT"]);
const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();

export type AiToolResult =
  | {
      answer: string;
      asOf: string;
      fields: readonly string[];
      ok: true;
      tool: AiToolName;
    }
  | {
      answer: string;
      code: "AI_TOOL_UNAVAILABLE";
      ok: false;
      tool: AiToolName;
    };

type ToolOptions = {
  now?: Date;
  screenContext?: AiScreenContext;
  verifiedIdentity?: VerifiedIdentity;
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  ACTIVE: "진행 중",
  APPROVED: "승인됨",
  AUTO_HOLD: "자동 추가 확인 중",
  AWAITING_TRANSFER: "입금 대기",
  CANCELLED: "취소됨",
  COMPLETED: "완료",
  CONFIRMED: "확인 완료",
  CONVERTED: "전환 완료",
  DISQUALIFIED: "대상 제외",
  ENDED: "종료",
  EXPIRED: "기간 종료",
  IN_REVIEW: "검토 중",
  JOINED: "참여 중",
  ON_HOLD: "추가 확인 중",
  PAID: "지급 완료",
  PENDING: "대기 중",
  PENDING_QUALIFICATION: "자격 확인 중",
  PROCESSING: "처리 중",
  QUALIFIED: "자격 확인 완료",
  READY: "시작 전",
  REJECTED: "반려됨",
  REVERSED: "취소·환수됨",
  REQUESTED: "요청 접수",
  REQUIRES_RESUBMISSION: "재제출 필요",
  REVIEWING: "검토 중",
  REWARDED: "보상 완료",
  SCHEDULED: "예정",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? "상태 확인됨";
}

function asAtomicDisplay(value: unknown, currency: DisplayCurrency) {
  return formatAtomicAmount(atomicSchema.parse(value), currency);
}

async function walletSummary(
  supabase: SupabaseClient,
  now: Date,
  ownerId?: string,
) {
  const rowSchema = z.object({
    available_balance_atomic: atomicSchema,
    balance_atomic: atomicSchema,
    currency: z.literal("KRW"),
  });
  let query = supabase
    .from("wallet_balance_snapshots")
    .select("currency, balance_atomic, available_balance_atomic")
    .eq("currency", "KRW")
    .order("currency");
  if (ownerId) query = query.eq("user_id", ownerId);
  const { data, error } = await query;
  if (error) throw new Error("WALLET_QUERY_FAILED");
  const rows = rowSchema.array().parse(data ?? []);
  const answer = rows.length
    ? `${rows
        .map((row) => {
          const heldAtomic =
            BigInt(row.balance_atomic) - BigInt(row.available_balance_atomic);
          if (heldAtomic < 0n) {
            throw new Error("INVALID_WALLET_PROJECTION");
          }
          const won = (atomic: string) =>
            formatAtomicAmount(atomic, "KRW").replace(/\sKRW$/, "원");
          return `현재 원화 지갑 잔액은 ${won(row.balance_atomic)}이에요. 사용할 수 있는 금액은 ${won(row.available_balance_atomic)}, 예약·보류된 금액은 ${won(heldAtomic.toString())}이에요.`;
        })
        .join("\n")}`
    : "아직 확인할 수 있는 본인 지갑이 없습니다.";
  return success("wallet.summary", answer, now, [
    "available",
    "balance",
    "currency",
    "held",
  ]);
}


async function latestDeposit(
  supabase: SupabaseClient,
  now: Date,
  screenContext?: AiScreenContext,
) {
  const rowSchema = z.object({
    amount_atomic: atomicSchema,
    currency: currencySchema,
    requested_at: timestampSchema,
    status: z.string().min(1).max(40),
  });
  let query = supabase
    .from("deposit_requests")
    .select("amount_atomic, currency, requested_at, status")
    .order("requested_at", { ascending: false })
    .limit(1);
  if (screenContext?.selectedTransaction) {
    query = query.eq("id", screenContext.selectedTransaction);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("DEPOSIT_QUERY_FAILED");
  if (!data) {
    return success(
      "deposit.latest_status",
      "확인 가능한 본인 입금 요청이 없습니다.",
      now,
      ["status"],
    );
  }
  const row = rowSchema.parse(data);
  return success(
    "deposit.latest_status",
    `최근 본인 입금 요청은 ${asAtomicDisplay(row.amount_atomic, row.currency)}이며 현재 ${statusLabel(row.status)} 상태입니다. 요청 시각은 ${formatProductDateTime(row.requested_at)}입니다.`,
    now,
    ["amount", "currency", "requested_at", "status"],
  );
}

async function latestWithdrawal(
  supabase: SupabaseClient,
  now: Date,
  screenContext?: AiScreenContext,
) {
  const rowSchema = z.object({
    amount_atomic: atomicSchema,
    currency: currencySchema,
    requested_at: timestampSchema,
    reviewed_at: nullableTimestampSchema,
    status: z.string().min(1).max(40),
  });
  let query = supabase
    .from("withdrawal_requests")
    .select("amount_atomic, currency, requested_at, reviewed_at, status")
    .order("requested_at", { ascending: false })
    .limit(1);
  if (screenContext?.selectedTransaction) {
    query = query.eq("id", screenContext.selectedTransaction);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("WITHDRAWAL_QUERY_FAILED");
  if (!data) {
    return success(
      "withdrawal.latest_status",
      "확인 가능한 본인 출금 요청이 없습니다.",
      now,
      ["status"],
    );
  }
  const row = rowSchema.parse(data);
  const reviewed = row.reviewed_at
    ? ` 마지막 검토 시각은 ${formatProductDateTime(row.reviewed_at)}입니다.`
    : "";
  return success(
    "withdrawal.latest_status",
    `최근 본인 출금 요청은 ${asAtomicDisplay(row.amount_atomic, row.currency)}이며 현재 ${statusLabel(row.status)} 상태입니다. 요청 시각은 ${formatProductDateTime(row.requested_at)}입니다.${reviewed}`,
    now,
    ["amount", "currency", "requested_at", "status"],
  );
}


async function referralStatus(supabase: SupabaseClient, now: Date) {
  const rowSchema = z.object({
    amount_atomic: atomicSchema,
    paid_at: nullableTimestampSchema,
    status: z.string().min(1).max(40),
  });
  const { data, error } = await supabase
    .from("referral_reward_claims")
    .select("amount_atomic, paid_at, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("REFERRAL_QUERY_FAILED");
  if (!data) {
    const qualificationSchema = z.object({
      next_review_at: nullableTimestampSchema,
      stage: z.enum(["STAGE_1", "STAGE_2"]),
      status: z.string().min(1).max(40),
    });
    const { data: qualificationData, error: qualificationError } =
      await supabase
        .from("referral_qualifications")
        .select("stage, status, next_review_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (qualificationError) throw new Error("REFERRAL_QUERY_FAILED");
    if (qualificationData) {
      const qualification = qualificationSchema.parse(qualificationData);
      const stageLabel =
        qualification.stage === "STAGE_1"
          ? "첫 번째 자격 단계"
          : "두 번째 자격 단계";
      const nextReview = qualification.next_review_at
        ? ` 다음 확인 예정 시각은 ${formatProductDateTime(qualification.next_review_at)}입니다.`
        : "";
      return success(
        "referral.status",
        `최근 친구 초대는 ${stageLabel}에서 ${statusLabel(qualification.status)} 상태입니다. 아직 본인에게 생성된 보상 청구는 없습니다.${nextReview}`,
        now,
        ["next_review_at", "qualification_stage", "status"],
      );
    }
    return success(
      "referral.status",
      "확인 가능한 본인 추천 보상 청구가 없습니다. 초대 자체와 보상 자격 확정은 서로 다른 단계입니다.",
      now,
      ["status"],
    );
  }
  const row = rowSchema.parse(data);
  const paid = row.paid_at
    ? ` 지급 시각은 ${formatProductDateTime(row.paid_at)}입니다.`
    : "";
  return success(
    "referral.status",
    `최근 본인 추천 보상은 ${formatAtomicAmount(row.amount_atomic, "KRW")}이고 현재 ${statusLabel(row.status)} 상태입니다.${paid}`,
    now,
    ["amount", "paid_at", "status"],
  );
}

async function eventProgress(
  supabase: SupabaseClient,
  now: Date,
  screenContext?: AiScreenContext,
) {
  const participantSchema = z.object({
    completed_at: nullableTimestampSchema,
    event_id: z.uuid(),
    status: z.string().min(1).max(40),
    updated_at: timestampSchema,
  });
  let query = supabase
    .from("event_participants")
    .select("event_id, status, completed_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (screenContext?.selectedEvent) {
    query = query.eq("event_id", screenContext.selectedEvent);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("EVENT_PROGRESS_QUERY_FAILED");
  if (!data) {
    return success(
      "event.progress",
      "확인 가능한 본인 이벤트 참여 기록이 없습니다.",
      now,
      ["status"],
    );
  }
  const participant = participantSchema.parse(data);
  const { data: eventData, error: eventError } = await supabase
    .from("events")
    .select("title_ko")
    .eq("id", participant.event_id)
    .maybeSingle();
  if (eventError) throw new Error("EVENT_TITLE_QUERY_FAILED");
  const eventTitle = z
    .object({ title_ko: z.string().min(1).max(100) })
    .nullable()
    .parse(eventData)?.title_ko;
  const completed = participant.completed_at
    ? ` 완료 시각은 ${formatProductDateTime(participant.completed_at)}입니다.`
    : "";
  return success(
    "event.progress",
    `${eventTitle ?? "선택한 이벤트"}의 본인 참여 상태는 ${statusLabel(participant.status)}입니다. 마지막 확인 시각은 ${formatProductDateTime(participant.updated_at)}입니다.${completed}`,
    now,
    ["completed_at", "event_title", "status", "updated_at"],
  );
}

async function recentNotification(supabase: SupabaseClient, now: Date) {
  const rowSchema = z.object({
    created_at: timestampSchema,
    title_ko: z.string().min(1).max(100),
  });
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase
      .from("notifications")
      .select("title_ko, created_at")
      .or(activeMemberNotificationExpiryOr(now))
      .lte("scheduled_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .or(activeMemberNotificationExpiryOr(now))
      .lte("scheduled_at", now.toISOString())
      .is("read_at", null),
  ]);
  if (error || countError) throw new Error("NOTIFICATION_QUERY_FAILED");
  if (!data) {
    return success(
      "notification.recent",
      "현재 확인 가능한 본인 알림이 없습니다.",
      now,
      ["unread_count"],
    );
  }
  const row = rowSchema.parse(data);
  return success(
    "notification.recent",
    `읽지 않은 본인 알림은 ${(count ?? 0).toLocaleString("ko-KR")}개입니다. 최근 알림은 “${row.title_ko}”이며 ${formatProductDateTime(row.created_at)}에 도착했습니다.`,
    now,
    ["created_at", "title", "unread_count"],
  );
}

async function kycStatus(supabase: SupabaseClient, now: Date) {
  const rowSchema = z.object({
    opened_at: timestampSchema,
    status: z.string().min(1).max(40),
    updated_at: timestampSchema,
  });
  const { data, error } = await supabase
    .from("kyc_cases")
    .select("status, opened_at, updated_at")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("KYC_QUERY_FAILED");
  if (!data) {
    return success("kyc.status", "확인 가능한 본인 확인 기록이 없어요.", now, [
      "status",
    ]);
  }
  const row = rowSchema.parse(data);
  return success(
    "kyc.status",
    `본인 확인은 현재 ${statusLabel(row.status)} 상태예요. 마지막 확인 시각은 ${formatProductDateTime(row.updated_at)}이에요.`,
    now,
    ["opened_at", "status", "updated_at"],
  );
}

function success(
  tool: AiToolName,
  answer: string,
  now: Date,
  fields: readonly string[],
): AiToolResult {
  return {
    answer,
    asOf: now.toISOString(),
    fields,
    ok: true,
    tool,
  };
}

export async function executeAiTool(
  supabase: SupabaseClient,
  tool: AiToolName,
  options: ToolOptions = {},
): Promise<AiToolResult> {
  if (
    Object.prototype.hasOwnProperty.call(options, "userId") ||
    Object.prototype.hasOwnProperty.call(options, "subjectUserId")
  ) {
    return {
      answer: getAiToolFailureCopy(tool),
      code: "AI_TOOL_UNAVAILABLE",
      ok: false,
      tool,
    };
  }
  const now = options.now ?? new Date();
  try {
    const identity = options.verifiedIdentity;
    if (identity) {
      if (identity.supabase !== supabase)
        throw Error("AI_TOOL_OWNER_CLIENT_MISMATCH");
      await assertOwnedToolIdentity(identity);
    }
    switch (tool) {
      case "ai.usage":
      case "ai.cancelled_history": {
        if (!identity) throw Error("AI_TOOL_OWNER_REQUIRED");
        const answer =
          tool === "ai.usage"
            ? await ownedAiQuotaFacts(identity, now)
            : await ownedCancelledAiFacts(identity);
        await assertOwnedToolIdentity(identity);
        return success(
          tool,
          answer,
          now,
          tool === "ai.usage"
            ? ["rolling_minute", "rolling_24h", "next_available_at"]
            : ["cancelled_count"],
        );
      }
      case "deposit.latest_status":
        return await latestDeposit(supabase, now, options.screenContext);
      case "event.progress":
        return await eventProgress(supabase, now, options.screenContext);
      case "kyc.status":
        return await kycStatus(supabase, now);
      case "notification.recent":
        return await recentNotification(supabase, now);
      case "referral.status":
        return await referralStatus(supabase, now);
      case "wallet.summary":
        return await walletSummary(supabase, now, identity?.userId);
      case "withdrawal.latest_status":
        return await latestWithdrawal(supabase, now, options.screenContext);
    }
  } catch {
    return {
      answer: getAiToolFailureCopy(tool),
      code: "AI_TOOL_UNAVAILABLE",
      ok: false,
      tool,
    };
  }
}
