import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  auditActionLabel,
  auditTargetLabel,
} from "@/app/(control)/_lib/today-snapshot";
import { formatKst } from "@/app/(control)/_lib/format";
import {
  operationStatus,
  operationType,
  type OperationSection,
  type OperationPanel,
  type OperationRecord,
  type OperationsSnapshot,
} from "./registry";

type Source = {
  key: string;
  title: string;
  table: string;
  columns: string;
  order: string;
  recent?: boolean;
};
const sources: Record<OperationSection, readonly Source[]> = {
  events: [
    {
      key: "events",
      title: "행사 일정",
      table: "events",
      columns: "id,title_ko,summary_ko,status,starts_at,ends_at",
      order: "starts_at",
    },
  ],
  notices: [
    {
      key: "notices",
      title: "공지 목록",
      table: "notices",
      columns: "id,title_ko,summary_ko,status,updated_at",
      order: "updated_at",
    },
  ],
  notifications: [
    {
      key: "deliveries",
      title: "알림 전달 기록",
      table: "notification_deliveries",
      columns: "id,channel,status,attempt_count,updated_at",
      order: "updated_at",
    },
  ],
  support: [],
  ledger: [
    {
      key: "ledger",
      title: "확정 거래",
      table: "ledger_transactions",
      columns: "id,category,currency,member_user_id,posted_at",
      order: "posted_at",
    },
  ],
  mining: [
    {
      key: "mining",
      title: "채굴 기록",
      table: "mining_sessions",
      columns: "id,user_id,status,started_at,last_settled_at,ended_at",
      order: "started_at",
    },
  ],
  audit: [
    {
      key: "audit",
      title: "최근 운영 기록",
      table: "audit_logs",
      columns: "id,action,target_type,created_at",
      order: "created_at",
    },
  ],
  analytics: [
    {
      key: "signups",
      title: "최근 하루 가입",
      table: "user_profiles",
      columns: "user_id,created_at",
      order: "created_at",
      recent: true,
    },
    {
      key: "analytics",
      title: "최근 하루 이용 기록",
      table: "analytics_events",
      columns: "id,event_name,occurred_at",
      order: "occurred_at",
      recent: true,
    },
  ],
  system: [
    {
      key: "status",
      title: "서비스 상태 보고",
      table: "system_status",
      columns: "id,component,status,public_message_ko,observed_at",
      order: "observed_at",
    },
    {
      key: "jobs",
      title: "자동 작업",
      table: "system_jobs",
      columns: "id,job_type,status,attempts,updated_at,dead_lettered_at",
      order: "updated_at",
    },
  ],
};
const uuid = z.uuid();
const date = z.iso.datetime({ offset: true });

function safeDate(value: unknown) {
  return date.safeParse(value).success ? String(value) : null;
}
function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 500)
    : fallback;
}

/** Narrow presentation projection: no payload, token, address, risk weights or SQL. */
export function projectOperationRecord(
  key: string,
  row: Record<string, unknown>,
): OperationRecord | null {
  const id = uuid.safeParse(row.id ?? row.user_id);
  if (!id.success) return null;
  const member = uuid.safeParse(row.member_user_id ?? row.user_id);
  const common: OperationRecord = {
    id: id.data,
    title: "운영 기록",
    status: operationStatus(row.status),
    at: safeDate(
      row.updated_at ??
        row.created_at ??
        row.occurred_at ??
        row.posted_at ??
        row.started_at ??
        row.observed_at,
    ),
    detail: null,
    memberId: member.success ? member.data : null,
  };
  switch (key) {
    case "events":
      return {
        ...common,
        title: text(row.title_ko, "행사 제목 확인 필요"),
        at: safeDate(row.starts_at),
        detail: text(row.summary_ko, "안내 확인 필요"),
      };
    case "notices":
      return {
        ...common,
        title: text(row.title_ko, "공지 제목 확인 필요"),
        detail: text(row.summary_ko, "안내 확인 필요"),
      };
    case "deliveries":
      return {
        ...common,
        title: operationStatus(row.channel),
        detail:
          Number.isSafeInteger(row.attempt_count) &&
          Number(row.attempt_count) >= 0
            ? `전달 시도 ${row.attempt_count}회`
            : "전달 시도 확인 필요",
      };
    case "ledger":
      return {
        ...common,
        title: operationType(row.category),
        status: "거래 기록",
        detail:
          row.currency === "KRW"
            ? "원화 거래 · 금액과 잔액은 회원 상세에서 확인해요."
            : "통화와 상세 기록 확인 필요",
      };
    case "mining":
      return {
        ...common,
        title: "회원 채굴",
        status: row.ended_at ? "종료 기록" : operationStatus(row.status),
        detail: safeDate(row.last_settled_at)
          ? `마지막 정산 · ${formatKst(String(row.last_settled_at))}`
          : "마지막 정산 시각 확인 필요",
      };
    case "audit":
      return {
        ...common,
        title: auditActionLabel(text(row.action, "")),
        status: auditTargetLabel(text(row.target_type, "")),
      };
    case "signups":
      return { ...common, title: "회원 가입", status: "가입 기록" };
    case "analytics":
      return {
        ...common,
        title: "서비스 이용",
        status: "이용 기록",
        memberId: null,
      };
    case "status":
      return {
        ...common,
        title: operationType(row.component),
        detail: text(row.public_message_ko, "상태 안내 확인 필요"),
      };
    case "jobs":
      return {
        ...common,
        title: operationType(row.job_type),
        status: row.dead_lettered_at
          ? "격리 · 확인 필요"
          : operationStatus(row.status),
        detail:
          Number.isSafeInteger(row.attempts) && Number(row.attempts) >= 0
            ? `처리 시도 ${row.attempts}회`
            : "처리 시도 확인 필요",
      };
    default:
      return null;
  }
}

export async function readOperationsSnapshot(
  db: SupabaseClient,
  section: OperationSection,
  now = new Date(),
): Promise<OperationsSnapshot> {
  const panels = await Promise.all(
    sources[section].map(async (source): Promise<OperationPanel> => {
      const unavailable: OperationPanel = {
        key: source.key,
        title: source.title,
        state: "unavailable",
        count: null,
        rows: [],
      };
      try {
        let query = db
          .from(source.table)
          .select(source.columns, { count: "exact" })
          .order(source.order, { ascending: false })
          .limit(20);
        if (source.recent)
          query = query
            .gte(
              source.order,
              new Date(now.getTime() - 86_400_000).toISOString(),
            )
            .lte(source.order, now.toISOString());
        const result = await query.abortSignal(AbortSignal.timeout(8000));
        if (
          result.error ||
          !Array.isArray(result.data) ||
          !Number.isSafeInteger(result.count) ||
          Number(result.count) < 0
        )
          return unavailable;
        if (
          Number(result.count) < result.data.length ||
          (Number(result.count) > 0 && result.data.length === 0)
        )
          return unavailable;
        const rows = result.data.map((row) =>
          projectOperationRecord(
            source.key,
            row as unknown as Record<string, unknown>,
          ),
        );
        if (rows.some((row) => row === null)) return unavailable;
        return {
          key: source.key,
          title: source.title,
          state: "ready",
          count: result.count,
          rows: rows as OperationRecord[],
        };
      } catch {
        return unavailable;
      }
    }),
  );
  return { section, observedAt: now.toISOString(), panels };
}
