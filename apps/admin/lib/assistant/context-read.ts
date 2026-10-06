import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { formatKst, formatKrw, formatUsdt } from "@/app/(control)/_lib/format";
import { auditActionLabel } from "@/app/(control)/_lib/today-snapshot";
import { presentMemberLifecycle } from "@/app/(control)/members/_lib/member-state-display";
import { presentMemberMoneySources } from "@/app/(control)/members/_lib/money-source-display";
import {
  presentAdminMiningFunding,
  resolveMiningServerDisplayRead,
} from "@/app/(control)/members/_lib/mining-funding-display";
import { PENDING_KRW_DEPOSIT_STATUSES } from "@/lib/deposits/krw-queue";
import { maskMemberName } from "@/lib/members/search";
import { ACTIONABLE_WITHDRAWAL_STATUSES } from "@/lib/withdrawals/queue-statuses";

import { contextReportBuilder, type AssistantContextInput } from "./context";

type Read = { data?: unknown; count?: number | null; error?: unknown };
type Builder = ReturnType<typeof contextReportBuilder>;
const when = z.iso.datetime({ offset: true });
const atomic = z.union([
  z.string().regex(/^(0|[1-9][0-9]{0,37})$/),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String),
]);
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usdtText = z.string().regex(/^(0|[1-9][0-9]{0,31})(?:\.[0-9]{1,6})?$/);
const usdtAmount = z.union([
  usdtText,
  z
    .number()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER / 1_000_000)
    .transform(String)
    .pipe(usdtText),
]);
const depositStates = z.enum([
  "REQUESTED",
  "AWAITING_TRANSFER",
  "REVIEWING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);
const withdrawalStates = z.enum([
  "REQUESTED",
  "REVIEWING",
  "APPROVED",
  "PROCESSING",
  "ADMIN_PROCESSING",
  "EXTERNAL_SENT_RECORDED",
  "LEDGER_FINALIZED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "HELD",
]);
const depositSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  status: depositStates,
  amount_atomic: atomic,
  currency: z.literal("KRW"),
  requested_at: when,
});
const usdtSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  status: z.enum(["SUBMITTED", "CONFIRMED", "REJECTED"]),
  sent_usdt_amount: usdtAmount,
  credited_krw: atomic.nullable(),
  created_at: when,
});
const withdrawalSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  status: withdrawalStates,
  amount_atomic: atomic,
  destination_type: z.enum(["KRW_BANK", "USDT_ADDRESS"]),
  requested_at: when,
});
const DEPOSIT_FIELDS = "id,user_id,status,amount_atomic,currency,requested_at";
const USDT_FIELDS =
  "id,user_id,status,sent_usdt_amount,credited_krw,created_at";
const WITHDRAWAL_FIELDS =
  "id,user_id,status,amount_atomic,destination_type,requested_at";
const SOURCE_FIELDS =
  "user_id,schema_version,coverage,unclassified_wallet_entries,unconnected_withdrawals,unclassified_journals,invalid_source_receipts,eligible_principal_atomic,held_principal_atomic,recovered_principal_atomic,recorded_krw_principal_deposits_atomic,recorded_usdt_principal_credits_atomic,recorded_bonus_atomic,observed_at,capture_started_at";

async function read(query: PromiseLike<Read>): Promise<Read> {
  try {
    return await query;
  } catch {
    return { error: true };
  }
}
function rows<T>(
  result: Read,
  schema: z.ZodType<T>,
  limit: number,
): T[] | null {
  if (result.error) return null;
  const parsed = z.array(schema).max(limit).safeParse(result.data);
  return parsed.success ? parsed.data : null;
}
function item<T>(result: Read, schema: z.ZodType<T>): T | null {
  if (result.error) return null;
  const parsed = schema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}
function addCount(builder: Builder, result: Read, label: string, href: string) {
  const parsed = countSchema.safeParse(result.count);
  if (result.error || !parsed.success) {
    builder.add("UNKNOWN", `${label} 건수를 확인하지 못했습니다.`, href, label);
    return null;
  }
  builder.add(
    "FACT",
    `${label} ${parsed.data.toLocaleString("ko-KR")}건입니다.`,
    href,
    label,
  );
  return parsed.data;
}
function kstToday(now: Date) {
  const day =
    Math.floor((now.getTime() + 9 * 3_600_000) / 86_400_000) * 86_400_000 -
    9 * 3_600_000;
  return {
    start: new Date(day).toISOString(),
    end: new Date(day + 86_400_000).toISOString(),
  };
}

async function dashboard(db: SupabaseClient, builder: Builder, now: Date) {
  const day = kstToday(now);
  const results = await Promise.all([
    read(
      db
        .from("deposit_requests")
        .select("id", { count: "exact", head: true })
        .eq("currency", "KRW")
        .in("status", [...PENDING_KRW_DEPOSIT_STATUSES]),
    ),
    read(
      db
        .from("usdt_manual_deposits")
        .select("id", { count: "exact", head: true })
        .eq("status", "SUBMITTED"),
    ),
    read(
      db
        .from("withdrawal_requests")
        .select("id", { count: "exact", head: true })
        .eq("destination_type", "KRW_BANK")
        .in("status", [...ACTIONABLE_WITHDRAWAL_STATUSES]),
    ),
    read(
      db
        .from("withdrawal_requests")
        .select("id", { count: "exact", head: true })
        .eq("destination_type", "USDT_ADDRESS")
        .in("status", [...ACTIONABLE_WITHDRAWAL_STATUSES]),
    ),
    read(
      db
        .from("reconciliation_mismatches")
        .select("id", { count: "exact", head: true })
        .in("status", ["OPEN", "INVESTIGATING"]),
    ),
    read(
      db
        .from("system_jobs")
        .select("id", { count: "exact", head: true })
        .or("status.eq.FAILED,dead_lettered_at.not.is.null"),
    ),
    read(
      db
        .from("safe_mode_controls")
        .select("id", { count: "exact", head: true })
        .eq("is_paused", true),
    ),
    read(
      db
        .from("user_profiles")
        .select("user_id", { count: "exact", head: true })
        .gte("created_at", day.start)
        .lt("created_at", day.end),
    ),
  ]);
  const descriptions = [
    ["원화 입금 대기", "/deposits/krw"],
    ["USDT 입금 대기", "/deposits/usdt"],
    ["계좌 출금 확인", "/withdrawals/krw-bank"],
    ["USDT 출금 확인", "/withdrawals/usdt"],
    ["열린 대사 차이", "/exceptions"],
    ["실패·격리된 자동 작업", "/exceptions"],
    ["일시 정지된 기능", "/restrictions"],
    ["오늘 가입한 회원", "/members"],
  ] as const;
  const counts = descriptions.map(([label, href], index) =>
    addCount(builder, results[index]!, label, href),
  );
  if ((counts[4] ?? 0) > 0 || (counts[5] ?? 0) > 0) {
    builder.add(
      "INFERENCE",
      "일부 정산이나 안내가 늦어질 수 있습니다. 정확한 원인은 예외 기록을 확인해야 합니다.",
      "/exceptions",
      "정산·대사 예외",
    );
    builder.add(
      "RECOMMENDATION",
      "먼저 예외 화면에서 실패·차이의 근거를 확인하세요. 잔액을 직접 고치거나 같은 송금을 반복하지 마세요.",
      "/exceptions",
      "예외 확인",
    );
  }
  if ((counts[6] ?? 0) > 0)
    builder.add(
      "RECOMMENDATION",
      "일시 정지된 기능의 사유와 검토 시점을 확인하세요. 해제는 기존 화면에서 별도로 검토해야 합니다.",
      "/restrictions",
      "제한 확인",
    );
  builder.add(
    "RECOMMENDATION",
    "입출금은 해당 대기열에서 증빙·현재 상태·반영 금액을 확인한 뒤 기존 승인 절차를 따르세요.",
    "/",
    "오늘의 퍼뜩",
  );
  builder.add(
    "UNKNOWN",
    "대기열 건수만으로 전체 시스템 정상 여부나 실제 송금 완료를 판단할 수 없습니다.",
    "/",
    "오늘의 퍼뜩",
  );
  builder.add(
    "UNKNOWN",
    "지원 문의 집계·분석 변화·원격 서비스 상태는 이 조회에 연결되어 있지 않습니다.",
    "/",
    "현재 운영 화면",
  );
  builder.add(
    "RECOMMENDATION",
    "본인 확인은 권한이 적용되는 별도 검토 화면에서 확인하세요.",
    "/kyc",
    "본인 확인 검토",
  );
}

async function transactionQueues(
  db: SupabaseClient,
  builder: Builder,
  topic: "deposits" | "withdrawals",
) {
  if (topic === "deposits") {
    const [krw, usdt] = await Promise.all([
      read(
        db
          .from("deposit_requests")
          .select(DEPOSIT_FIELDS, { count: "exact" })
          .eq("currency", "KRW")
          .in("status", [...PENDING_KRW_DEPOSIT_STATUSES])
          .order("requested_at")
          .limit(5),
      ),
      read(
        db
          .from("usdt_manual_deposits")
          .select(USDT_FIELDS, { count: "exact" })
          .eq("status", "SUBMITTED")
          .order("created_at")
          .limit(5),
      ),
    ]);
    addCount(builder, krw, "원화 입금 대기", "/deposits/krw");
    addCount(builder, usdt, "USDT 입금 대기", "/deposits/usdt");
    for (const [index, row] of (rows(krw, depositSchema, 5) ?? []).entries())
      builder.choice(
        `원화 신청 ${index + 1} · ${formatKrw(row.amount_atomic)} · ${formatKst(row.requested_at)}`,
        { topic: "deposit-case", currency: "KRW", recordId: row.id },
      );
    for (const [index, row] of (rows(usdt, usdtSchema, 5) ?? []).entries())
      builder.choice(
        `USDT 신청 ${index + 1} · ${formatUsdt(row.sent_usdt_amount)} · ${formatKst(row.created_at)}`,
        { topic: "deposit-case", currency: "USDT", recordId: row.id },
      );
    if (
      rows(krw, depositSchema, 5) === null ||
      rows(usdt, usdtSchema, 5) === null
    )
      builder.add(
        "UNKNOWN",
        "일부 신청의 상세 정보를 확인하지 못했습니다.",
        "/deposits/krw",
        "입금 내역",
      );
    builder.add(
      "RECOMMENDATION",
      "아래 신청을 선택해 현재 상태를 확인하세요. 오래된 신청부터 종류별 최대 5건을 보여줍니다.",
      "/deposits/krw",
      "입금 내역",
    );
    builder.add(
      "UNKNOWN",
      "외부 이체 증빙과 USDT 환산 원화는 운영자가 기존 입금 화면에서 확인해야 합니다.",
      "/deposits/usdt",
      "USDT 입금 내역",
    );
  } else {
    const result = await read(
      db
        .from("withdrawal_requests")
        .select(WITHDRAWAL_FIELDS, { count: "exact" })
        .in("status", [...ACTIONABLE_WITHDRAWAL_STATUSES])
        .order("requested_at")
        .limit(10),
    );
    addCount(builder, result, "확인할 출금", "/withdrawals/krw-bank");
    const selected = rows(result, withdrawalSchema, 10);
    if (selected === null)
      builder.add(
        "UNKNOWN",
        "출금 신청의 상세 정보를 확인하지 못했습니다.",
        "/withdrawals/krw-bank",
        "출금 내역",
      );
    for (const [index, row] of (selected ?? []).entries())
      builder.choice(
        `${row.destination_type === "KRW_BANK" ? "계좌" : "USDT"} 신청 ${index + 1} · ${formatKrw(row.amount_atomic)} · ${formatKst(row.requested_at)}`,
        { topic: "withdrawal-case", recordId: row.id },
      );
    builder.add(
      "RECOMMENDATION",
      "신청별 현재 상태를 먼저 확인하세요. 오래된 신청부터 최대 10건을 보여줍니다.",
      "/withdrawals/krw-bank",
      "출금 내역",
    );
    builder.add(
      "UNKNOWN",
      "신청 금액은 원화 잔액 기준입니다. 외부 송금 완료는 신청만으로 확인할 수 없습니다.",
      "/withdrawals/usdt",
      "USDT 출금 내역",
    );
  }
}

async function transactionCase(
  db: SupabaseClient,
  builder: Builder,
  input: Extract<AssistantContextInput, { recordId: string }>,
) {
  if (input.topic === "deposit-case") {
    const usdt = input.currency === "USDT";
    const result = await read(
      db
        .from(usdt ? "usdt_manual_deposits" : "deposit_requests")
        .select(usdt ? USDT_FIELDS : DEPOSIT_FIELDS)
        .eq("id", input.recordId)
        .maybeSingle(),
    );
    const row = usdt ? item(result, usdtSchema) : item(result, depositSchema);
    const href = usdt
      ? `/deposits/usdt#usdt-deposit-${input.recordId}`
      : `/deposits/krw/${input.recordId}`;
    if (!row || row.id !== input.recordId) {
      builder.add(
        "UNKNOWN",
        "선택한 입금 신청의 현재 상태를 확인하지 못했습니다. 삭제 여부도 단정할 수 없습니다.",
        usdt ? "/deposits/usdt" : "/deposits/krw",
        "입금 내역",
      );
      return;
    }
    const pending = [
      "REQUESTED",
      "AWAITING_TRANSFER",
      "REVIEWING",
      "SUBMITTED",
    ].includes(row.status);
    const complete = row.status === "APPROVED" || row.status === "CONFIRMED";
    const state = pending
      ? "확인 대기"
      : complete
        ? "원화 반영 기록 있음"
        : row.status === "REJECTED"
          ? "반려 기록 있음"
          : "취소 기록 있음";
    builder.add(
      "FACT",
      `현재 입금 신청은 ${state} 상태입니다.`,
      href,
      "선택한 입금 신청",
    );
    if ("amount_atomic" in row)
      builder.add(
        "FACT",
        `신청 금액은 ${formatKrw(row.amount_atomic)}입니다.`,
        href,
        "원화 입금 신청",
      );
    else {
      builder.add(
        "FACT",
        `신청에 적힌 이체량은 ${formatUsdt(row.sent_usdt_amount)}입니다.`,
        href,
        "USDT 입금 신청",
      );
      if (complete && row.credited_krw !== null)
        builder.add(
          "FACT",
          `기록된 원화 반영 금액은 ${formatKrw(row.credited_krw)}입니다.`,
          href,
          "원화 반영 기록",
        );
    }
    builder.add(
      "RECOMMENDATION",
      pending
        ? "입금 내역에서 외부 이체 증빙과 실제 반영할 원화 금액을 확인하세요. 최종 확인과 작업 본인 확인은 기존 양식에서 진행합니다."
        : "이미 처리된 신청은 다시 승인하지 마세요. 관련 원화 기록과 현재 회원 상태를 확인하세요.",
      href,
      "입금 내역에서 검토",
    );
    builder.add(
      "UNKNOWN",
      "신청 내용만으로 외부 입금의 진위나 환산율을 판단할 수 없습니다.",
      href,
      "이체 증빙 확인",
    );
  } else {
    const row = item(
      await read(
        db
          .from("withdrawal_requests")
          .select(WITHDRAWAL_FIELDS)
          .eq("id", input.recordId)
          .maybeSingle(),
      ),
      withdrawalSchema,
    );
    if (!row || row.id !== input.recordId) {
      builder.add(
        "UNKNOWN",
        "선택한 출금 신청의 현재 상태를 확인하지 못했습니다.",
        "/withdrawals/krw-bank",
        "출금 내역",
      );
      return;
    }
    const href =
      row.destination_type === "KRW_BANK"
        ? "/withdrawals/krw-bank"
        : "/withdrawals/usdt";
    const sent = ["EXTERNAL_SENT_RECORDED"].includes(row.status);
    const finalized = ["LEDGER_FINALIZED", "COMPLETED"].includes(row.status);
    const released = ["REJECTED", "CANCELLED"].includes(row.status);
    const state = finalized
      ? "원장 확정 기록 있음"
      : sent
        ? "외부 송금 기록 있음"
        : released
          ? "거절·취소 기록 있음"
          : "처리 전 또는 진행 중";
    builder.add(
      "FACT",
      `현재 출금 신청은 ${state} 상태입니다. 신청 금액은 ${formatKrw(row.amount_atomic)}입니다.`,
      href,
      "선택한 출금 신청",
    );
    builder.add(
      "FACT",
      `신청 시각은 ${formatKst(row.requested_at)}입니다.`,
      href,
      "출금 신청 시각",
    );
    builder.add(
      "RECOMMENDATION",
      sent
        ? "송금을 반복하지 마세요. 기존 송금 증빙을 확인하고 해당 출금 화면에서 잔액 반영 단계만 검토하세요."
        : finalized || released
          ? "같은 신청을 다시 처리하지 마세요. 회원 기록과 기존 처리 결과를 확인하세요."
          : "외부 송금 결과를 먼저 확인하세요. 실패·응답 끊김만으로 재송금하거나 잔액 보류를 해제하지 마세요.",
      href,
      "출금 내역에서 검토",
    );
    builder.add(
      "UNKNOWN",
      "외부 송금 기록이나 실패 표시만으로 실제 은행·네트워크 결과를 확정할 수 없습니다.",
      href,
      "외부 증빙 확인",
    );
  }
}

async function wallet(db: SupabaseClient, builder: Builder, userId: string) {
  const href = `/members?id=${userId}#evidence-money-sources`;
  const [snapshot, provenance] = await Promise.all([
    read(
      db
        .from("wallet_balance_snapshots")
        .select("user_id,currency,balance_atomic,available_balance_atomic")
        .eq("user_id", userId)
        .eq("currency", "KRW")
        .maybeSingle(),
    ),
    read(
      db
        .from("money_source_summaries")
        .select(SOURCE_FIELDS)
        .eq("user_id", userId)
        .maybeSingle(),
    ),
  ]);
  const row = item(
    snapshot,
    z.object({
      user_id: z.uuid(),
      currency: z.literal("KRW"),
      balance_atomic: atomic,
      available_balance_atomic: atomic,
    }),
  );
  if (
    !row ||
    row.user_id !== userId ||
    BigInt(row.available_balance_atomic) > BigInt(row.balance_atomic)
  )
    builder.add(
      "UNKNOWN",
      "원화 지갑 잔액을 확인하지 못했습니다. 없는 값을 0원으로 표시하지 않습니다.",
      href,
      "회원 지갑 기록",
    );
  else {
    builder.add(
      "FACT",
      `지갑 총 잔액 ${formatKrw(row.balance_atomic)}, 사용 가능 ${formatKrw(row.available_balance_atomic)}, 보류·예약 ${formatKrw((BigInt(row.balance_atomic) - BigInt(row.available_balance_atomic)).toString())}입니다.`,
      href,
      "회원 원화 지갑",
    );
  }
  const source = presentMemberMoneySources(
    { data: provenance.data, error: provenance.error },
    userId,
  );
  if (source.complete) {
    for (const [label, value] of source.rows.filter(([label]) =>
      [
        "누적 원화 원금 입금",
        "누적 USDT 환산 원금",
        "누적 원금 회수",
        "출금 대기 원금",
        "채굴 인정 원금",
      ].includes(label),
    ))
      builder.add("FACT", `${label}: ${value}.`, href, "원금 출처 기록");
  } else
    builder.add(
      "UNKNOWN",
      "원금 출처의 연결이 확인되지 않았습니다. 입금 누계로 현재 사용 가능 잔액을 추정하지 마세요.",
      href,
      "원금 출처 확인",
    );
  builder.add(
    "UNKNOWN",
    "전체 원장의 정상 여부·누적 채굴 수익·누적 총 출금은 이 조회만으로 확정할 수 없습니다.",
    href,
    "원금 출처와 수익 구분",
  );
  builder.add(
    "RECOMMENDATION",
    "현재 지갑 잔액과 원금 출처를 따로 확인하세요. 차이가 의심되면 예외 기록을 확인하고 잔액을 직접 수정하지 마세요.",
    "/exceptions",
    "대사 차이 확인",
  );
}

async function mining(db: SupabaseClient, builder: Builder, userId: string) {
  const href = `/members?id=${userId}`;
  // The only RPC allowed here is the existing read-only server display, never settlement.
  const result = await read(
    db.rpc("read_own_mining_server_display", { p_user_id: userId }),
  );
  const display = presentAdminMiningFunding(
    resolveMiningServerDisplayRead(
      { data: result.data, error: result.error },
      null,
    ),
  );
  if (display.state === "ready") {
    for (const row of [
      ...display.rows,
      ...display.miningRows,
      ...display.cycleRows,
    ]) {
      const value =
        row.label === "등급" &&
        row.value !== "적용 전" &&
        row.value !== "확인할 수 없어요"
          ? "적용 기록 있음"
          : row.value;
      const unknown = ["확인 필요", "확인할 수 없어요", "아직 없어요"].includes(
        value,
      );
      builder.add(
        unknown ? "UNKNOWN" : "FACT",
        `${row.label}: ${unknown ? "확인하지 못했습니다" : value}.`,
        href,
        "회원 채굴 조회",
      );
    }
  } else
    builder.add(
      display.state === "empty" ? "FACT" : "UNKNOWN",
      display.state === "empty"
        ? "현재 채굴 조회에 표시할 원금 정보가 없습니다."
        : "현재 채굴 상태를 확인하지 못했습니다.",
      href,
      "회원 채굴 조회",
    );
  builder.add(
    "UNKNOWN",
    "정산 전·확인 전 금액은 확정된 지갑 잔액이 아닙니다. 화면 조회만으로 향후 수익을 보장할 수 없습니다.",
    href,
    "채굴과 확정 잔액 구분",
  );
  builder.add(
    "UNKNOWN",
    "실제 상품의 실행·정산 완료 여부는 이 조회만으로 확인할 수 없습니다.",
    href,
    "실제 실행 기록 확인",
  );
  builder.add(
    "RECOMMENDATION",
    "회원 상세의 채굴 상태와 정산 예외를 확인하세요. 화면의 진행 표시를 보고 금액이나 속도를 임의로 바꾸지 마세요.",
    href,
    "회원 상세 열기",
  );
}

async function member(db: SupabaseClient, builder: Builder, userId: string) {
  const href = `/members?id=${userId}`;
  const [profile, lifecycle, krw, usdt, withdrawals] = await Promise.all([
    read(
      db
        .from("user_profiles")
        .select("user_id,display_name,created_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ),
    read(
      db
        .from("member_lifecycle_states")
        .select("stage,first_funding_at,welcome_withdrawal_completed_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ),
    read(
      db
        .from("deposit_requests")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("currency", "KRW"),
    ),
    read(
      db
        .from("usdt_manual_deposits")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ),
    read(
      db
        .from("withdrawal_requests")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ),
  ]);
  const row = item(
    profile,
    z.object({
      user_id: z.uuid(),
      display_name: z.string().max(40).nullable(),
      created_at: when,
    }),
  );
  if (!row || row.user_id !== userId) {
    builder.add(
      "UNKNOWN",
      "선택한 회원의 현재 프로필을 확인하지 못했습니다.",
      "/members",
      "회원 다시 찾기",
    );
    return;
  }
  builder.add(
    "FACT",
    `${maskMemberName(row.display_name ?? "")} 회원의 가입 시각은 ${formatKst(row.created_at)}입니다.`,
    href,
    "회원 가입 기록",
  );
  const stage = presentMemberLifecycle({
    data: lifecycle.data,
    error: lifecycle.error,
  });
  builder.add(
    stage.available ? "FACT" : "UNKNOWN",
    stage.available
      ? `기록된 활동 단계는 ${stage.stage}입니다. 첫 입금: ${stage.firstFunding}.`
      : "회원의 활동 단계를 확인하지 못했습니다.",
    href,
    "회원 활동 기록",
  );
  addCount(builder, krw, "원화 입금 신청 기록", href);
  addCount(builder, usdt, "USDT 입금 신청 기록", href);
  addCount(builder, withdrawals, "출금 신청 기록", href);
  builder.add(
    "UNKNOWN",
    "신청 건수는 승인·정산 완료 건수가 아닙니다. 본인 확인 자료와 보호된 출금 목적지는 이 설명에 포함하지 않습니다.",
    href,
    "회원 기록 구분",
  );
  builder.add(
    "RECOMMENDATION",
    "지갑·원금 기록 또는 채굴 상태를 따로 확인하고, 개인정보 확인은 기존 회원 상세 권한을 따르세요.",
    href,
    "회원 상세 열기",
  );
}

async function jobs(db: SupabaseClient, builder: Builder) {
  const result = await read(
    db
      .from("system_jobs")
      .select("id,status,attempts,updated_at,dead_lettered_at", {
        count: "exact",
      })
      .or("status.eq.FAILED,dead_lettered_at.not.is.null")
      .order("updated_at")
      .limit(10),
  );
  const total = addCount(
    builder,
    result,
    "실패·격리된 자동 작업",
    "/exceptions",
  );
  const selected = rows(
    result,
    z.object({
      id: z.uuid(),
      status: z.string(),
      attempts: countSchema,
      updated_at: when,
      dead_lettered_at: when.nullable(),
    }),
    10,
  );
  if (selected === null)
    builder.add(
      "UNKNOWN",
      "실패 작업의 시도 횟수와 시각을 확인하지 못했습니다.",
      "/exceptions",
      "실패 작업",
    );
  for (const [index, row] of (selected ?? []).entries())
    builder.add(
      "FACT",
      `작업 ${index + 1}: ${row.dead_lettered_at ? "반복 처리를 멈추고 격리됨" : "실패 기록 있음"}, 시도 ${row.attempts}회, 마지막 변경 ${formatKst(row.updated_at)}.`,
      "/exceptions",
      "실패 작업 근거",
    );
  if (total !== null && total > 0)
    builder.add(
      "INFERENCE",
      "관련 정산이나 안내가 늦어질 수 있습니다. 실패 기록만으로 영향 범위나 원인은 확정할 수 없습니다.",
      "/exceptions",
      "자동 작업 영향 확인",
    );
  builder.add(
    "UNKNOWN",
    "비공개 작업 내용·오류 원문은 읽지 않았습니다. 실패 원인과 복구 성공 여부는 이 조회만으로 확인할 수 없습니다.",
    "/exceptions",
    "작업 원인 확인",
  );
  builder.add(
    "RECOMMENDATION",
    "예외 화면에서 관련 기록을 확인하세요. 자동 재실행이나 금전 수정 없이 담당자의 복구 절차를 따르세요.",
    "/exceptions",
    "실패 작업 확인",
  );
}

async function security(db: SupabaseClient, builder: Builder) {
  const [paused, risks] = await Promise.all([
    read(
      db
        .from("safe_mode_controls")
        .select("id", { count: "exact", head: true })
        .eq("is_paused", true),
    ),
    read(
      db
        .from("risk_flags")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null),
    ),
  ]);
  addCount(builder, paused, "일시 정지된 기능", "/restrictions");
  addCount(builder, risks, "미확인 위험 신호", "/restrictions");
  builder.add(
    "UNKNOWN",
    "위험 신호가 곧 부정행위 확정은 아닙니다. 침해 여부나 전체 보안 상태를 이 건수로 판단할 수 없습니다.",
    "/restrictions",
    "위험 신호 구분",
  );
  builder.add(
    "RECOMMENDATION",
    "제한 화면에서 현재 적용 범위와 검토 시점을 확인하세요. 원인을 확인하기 전에 제한을 자동 해제하지 마세요.",
    "/restrictions",
    "제한 상태 확인",
  );
}

async function audits(db: SupabaseClient, builder: Builder) {
  const result = await read(
    db
      .from("audit_logs")
      .select("id,action,created_at")
      .neq("action", "ADMIN_ASSISTANT_CONTEXT_READ")
      .order("created_at", { ascending: false })
      .limit(6),
  );
  const selected = rows(
    result,
    z.object({ id: z.uuid(), action: z.string().max(100), created_at: when }),
    6,
  );
  if (selected === null)
    builder.add(
      "UNKNOWN",
      "최근 운영 기록을 확인하지 못했습니다.",
      "/",
      "최근 운영 기록",
    );
  else {
    builder.add(
      "FACT",
      `최근 운영 기록 ${selected.length}건을 조회했습니다. 전체 누계가 아닙니다.`,
      "/",
      "최근 운영 기록",
    );
    for (const row of selected)
      builder.add(
        "FACT",
        `${auditActionLabel(row.action)} · ${formatKst(row.created_at)}.`,
        "/",
        "기록된 운영 조치",
      );
  }
  builder.add(
    "UNKNOWN",
    "감사 기록은 기록된 조치의 근거입니다. 외부 송금 결과나 모든 시스템의 정상 여부를 대신 증명하지 않습니다.",
    "/",
    "운영 기록의 범위",
  );
  builder.add(
    "RECOMMENDATION",
    "오늘의 퍼뜩에서 최근 기록을 확인하고, 관련 입출금·예외 화면의 실제 결과와 함께 비교하세요.",
    "/",
    "오늘의 퍼뜩 열기",
  );
}

/** Named reads only; the existing mining display is the sole read-only RPC. */
export async function readAssistantContext(
  db: SupabaseClient,
  input: AssistantContextInput,
  now = new Date(),
) {
  const titles: Record<AssistantContextInput["topic"], string> = {
    dashboard: "오늘 확인할 업무",
    member: "회원 기록 한눈에",
    deposits: "입금 확인 안내",
    withdrawals: "출금 확인 안내",
    "wallet-ledger": "지갑과 원금 기록",
    mining: "회원 채굴 상태",
    jobs: "실패한 자동 작업",
    security: "제한과 위험 신호",
    audit: "최근 운영 기록",
    "deposit-case": "선택한 입금 신청",
    "withdrawal-case": "선택한 출금 신청",
  };
  const builder = contextReportBuilder(titles[input.topic], now);
  if (input.topic === "dashboard") await dashboard(db, builder, now);
  else if (input.topic === "member") await member(db, builder, input.userId);
  else if (input.topic === "wallet-ledger")
    await wallet(db, builder, input.userId);
  else if (input.topic === "mining") await mining(db, builder, input.userId);
  else if (input.topic === "deposits" || input.topic === "withdrawals")
    await transactionQueues(db, builder, input.topic);
  else if (input.topic === "deposit-case" || input.topic === "withdrawal-case")
    await transactionCase(db, builder, input);
  else if (input.topic === "jobs") await jobs(db, builder);
  else if (input.topic === "security") await security(db, builder);
  else await audits(db, builder);
  return builder.finish();
}
