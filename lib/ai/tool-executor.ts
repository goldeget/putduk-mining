import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AiScreenContext } from "@/domain/ai/chat";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { formatProductDateTime } from "@/lib/i18n/date-time";

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

function kstDayWindow(now: Date) {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("INVALID_TOOL_CLOCK");
  }
  const kstOffsetMs = 9 * 60 * 60 * 1_000;
  const kstTime = now.getTime() + kstOffsetMs;
  const dayStartKst = Math.floor(kstTime / 86_400_000) * 86_400_000;
  const start = new Date(dayStartKst - kstOffsetMs);
  const end = new Date(dayStartKst + 86_400_000 - kstOffsetMs);
  return {
    date: start.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }),
    end: end.toISOString(),
    start: start.toISOString(),
  };
}

async function walletSummary(supabase: SupabaseClient, now: Date) {
  const rowSchema = z.object({
    available_balance_atomic: atomicSchema,
    balance_atomic: atomicSchema,
    currency: currencySchema,
  });
  const { data, error } = await supabase
    .from("wallet_balance_snapshots")
    .select("currency, balance_atomic, available_balance_atomic")
    .order("currency");
  if (error) throw new Error("WALLET_QUERY_FAILED");
  const rows = rowSchema.array().parse(data ?? []);
  const answer = rows.length
    ? `현재 본인 지갑은 ${rows
        .map((row) => {
          const heldAtomic =
            BigInt(row.balance_atomic) - BigInt(row.available_balance_atomic);
          if (heldAtomic < 0n) {
            throw new Error("INVALID_WALLET_PROJECTION");
          }
          return `${row.currency} 총 ${formatAtomicAmount(row.balance_atomic, row.currency)}, 사용 가능 ${formatAtomicAmount(row.available_balance_atomic, row.currency)}, 예약·보류 ${formatAtomicAmount(heldAtomic.toString(), row.currency)}`;
        })
        .join(" / ")}입니다. 확정된 잔액만 표시했습니다.`
    : "아직 확인할 수 있는 본인 지갑이 없습니다.";
  return success("wallet.summary", answer, now, [
    "available",
    "balance",
    "currency",
    "held",
  ]);
}

async function todayMiningReward(supabase: SupabaseClient, now: Date) {
  const walletSchema = z.object({ id: z.uuid() });
  const rowSchema = z.object({
    amount_atomic: atomicSchema,
    direction: z.enum(["CREDIT", "DEBIT"]),
  });
  const window = kstDayWindow(now);
  const { data: walletData, error: walletError } = await supabase
    .from("wallet_accounts")
    .select("id")
    .eq("currency", "KRW")
    .maybeSingle();
  if (walletError) throw new Error("MINING_REWARD_WALLET_QUERY_FAILED");
  if (!walletData) {
    return success(
      "mining.today_reward",
      `${window.date} KST 기준 본인 KRW 지갑에 확정 기록된 채굴 보상은 0 KRW입니다. 화면의 애니메이션 값이 아니라 확정된 기록만 합산했습니다.`,
      now,
      ["amount", "currency", "kst_date"],
    );
  }
  const wallet = walletSchema.parse(walletData);
  const { data, error } = await supabase
    .from("wallet_ledger")
    .select("amount_atomic, direction")
    .eq("wallet_account_id", wallet.id)
    .eq("entry_type", "MINING_REWARD")
    .gte("created_at", window.start)
    .lt("created_at", window.end);
  if (error) throw new Error("MINING_REWARD_QUERY_FAILED");
  const rows = rowSchema.array().parse(data ?? []);
  const total = rows.reduce(
    (sum, row) =>
      sum +
      (row.direction === "CREDIT"
        ? BigInt(row.amount_atomic)
        : -BigInt(row.amount_atomic)),
    0n,
  );
  const answer = `${window.date} KST 기준 본인 KRW 지갑에 확정 기록된 채굴 보상은 ${formatAtomicAmount(total.toString(), "KRW")}입니다. 화면의 애니메이션 값이 아니라 확정된 기록만 합산했습니다.`;
  return success("mining.today_reward", answer, now, [
    "amount",
    "currency",
    "kst_date",
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

async function trialStatus(supabase: SupabaseClient, now: Date) {
  const rowSchema = z.object({
    completed_at: nullableTimestampSchema,
    quota_consumed_bps: z.number().int().min(0).max(10_000),
    reward_atomic: atomicSchema,
    status: z.string().min(1).max(40),
    world_name_ko: z.string().min(1).max(80),
  });
  const { data, error } = await supabase
    .from("trial_account_snapshots")
    .select(
      "status, world_name_ko, quota_consumed_bps, reward_atomic, completed_at",
    )
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("TRIAL_QUERY_FAILED");
  if (!data) {
    return success(
      "trial.status",
      "아직 본인 계정에서 시작된 PUTDUK START 기록이 없습니다.",
      now,
      ["status"],
    );
  }
  const row = rowSchema.parse(data);
  const completed = row.completed_at
    ? ` 완료 시각은 ${formatProductDateTime(row.completed_at)}입니다.`
    : "";
  return success(
    "trial.status",
    `PUTDUK START는 ${row.world_name_ko} 월드에서 ${statusLabel(row.status)} 상태이며 진행률은 ${(row.quota_consumed_bps / 100).toFixed(0)}%입니다. 체험 결과는 ${formatTrialValue(row.reward_atomic)}이며 실제 지갑과 분리되어 있습니다.${completed}`,
    now,
    ["completed_at", "quota", "reward", "status", "world"],
  );
}

async function miningStatus(supabase: SupabaseClient, now: Date) {
  const rowSchema = z.object({
    started_at: timestampSchema,
    status: z.string().min(1).max(40),
    world_name_ko: z.string().min(1).max(80),
  });
  const { data, error } = await supabase
    .from("mining_active_session_snapshots")
    .select("world_name_ko, status, started_at")
    .order("started_at", { ascending: false });
  if (error) throw new Error("MINING_QUERY_FAILED");
  const rows = rowSchema.array().parse(data ?? []);
  const answer = rows.length
    ? `현재 본인 계정에는 ${rows.length.toLocaleString("ko-KR")}개의 활성 채굴 세션이 있습니다. 가장 최근 세션은 ${rows[0]?.world_name_ko ?? "확인된"} 월드에서 ${statusLabel(rows[0]?.status ?? "ACTIVE")} 상태이며 ${formatProductDateTime(rows[0]?.started_at ?? now)}에 시작했습니다.`
    : "현재 본인 계정에서 활성 상태인 채굴 세션은 없습니다.";
  return success("mining.status", answer, now, [
    "started_at",
    "status",
    "world",
  ]);
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
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
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
    return success(
      "kyc.status",
      "확인 가능한 본인 인증 사례가 없습니다.",
      now,
      ["status"],
    );
  }
  const row = rowSchema.parse(data);
  return success(
    "kyc.status",
    `본인 인증은 현재 ${statusLabel(row.status)} 상태입니다. 마지막 갱신 시각은 ${formatProductDateTime(row.updated_at)}입니다. 내부 위험 점수나 심사 기준은 표시하지 않습니다.`,
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
    switch (tool) {
      case "deposit.latest_status":
        return await latestDeposit(supabase, now, options.screenContext);
      case "event.progress":
        return await eventProgress(supabase, now, options.screenContext);
      case "kyc.status":
        return await kycStatus(supabase, now);
      case "mining.status":
        return await miningStatus(supabase, now);
      case "mining.today_reward":
        return await todayMiningReward(supabase, now);
      case "notification.recent":
        return await recentNotification(supabase, now);
      case "referral.status":
        return await referralStatus(supabase, now);
      case "trial.status":
        return await trialStatus(supabase, now);
      case "wallet.summary":
        return await walletSummary(supabase, now);
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
