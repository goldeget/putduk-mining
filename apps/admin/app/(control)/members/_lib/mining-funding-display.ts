import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type Read = { data?: unknown; error?: unknown };

export type AdminFundingRow = {
  label: string;
  value: string;
  tone?: "neutral" | "unconfirmed" | "highlight";
};

export type AdminFundingDisplay = {
  state: "empty" | "unavailable" | "ready";
  rows: AdminFundingRow[];
  monitoringRows: AdminFundingRow[];
  cycleRows: AdminFundingRow[];
};

const EMPTY_DISPLAY: AdminFundingDisplay = {
  state: "empty",
  rows: [],
  monitoringRows: [],
  cycleRows: [],
};

const UNAVAILABLE_DISPLAY: AdminFundingDisplay = {
  state: "unavailable",
  rows: [],
  monitoringRows: [],
  cycleRows: [],
};

/** Reads monitoring round + settlement data for a member (replaces mining server display). */
export function resolveMiningServerDisplayRead(
  roundRead: Read,
  _legacyPrincipalLots: Read | null,
): { data: unknown; error: unknown } {
  return { data: roundRead.data, error: roundRead.error };
}

/** Presents monitoring funding info for the admin member view. */
export function presentAdminMiningFunding(
  resolved: { data: unknown; error: unknown },
): AdminFundingDisplay {
  if (resolved.error || resolved.data == null) {
    return UNAVAILABLE_DISPLAY;
  }

  const data = resolved.data as {
    active_rounds?: number;
    total_stake?: string;
    total_settlement?: string;
    pending_settlement?: string;
    completed_rounds?: number;
    cycle_started_at?: string;
    cycle_end?: string;
  } | null;

  if (!data) {
    return EMPTY_DISPLAY;
  }

  const rows: AdminFundingRow[] = [];
  const monitoringRows: AdminFundingRow[] = [];
  const cycleRows: AdminFundingRow[] = [];

  if (data.total_stake) {
    rows.push({
      label: "모니터링 투자금",
      value: formatKrw(data.total_stake),
    });
  }
  if (data.pending_settlement) {
    rows.push({
      label: "정산 전 대기 수익",
      value: formatKrw(data.pending_settlement),
      tone: "unconfirmed",
    });
  }
  if (data.total_settlement) {
    rows.push({
      label: "확정 수익",
      value: formatKrw(data.total_settlement),
      tone: "highlight",
    });
  }

  monitoringRows.push({
    label: "활성 모니터링",
    value: `${data.active_rounds ?? 0}건`,
  });
  monitoringRows.push({
    label: "완료 모니터링",
    value: `${data.completed_rounds ?? 0}건`,
  });

  if (data.cycle_started_at && data.cycle_end) {
    cycleRows.push({
      label: "시작",
      value: data.cycle_started_at,
    });
    cycleRows.push({
      label: "종료",
      value: data.cycle_end,
    });
  }

  if (rows.length === 0 && monitoringRows.length === 0) {
    return EMPTY_DISPLAY;
  }

  return {
    state: "ready",
    rows,
    monitoringRows,
    cycleRows,
  };
}

function formatKrw(atomic: string): string {
  const value = BigInt(atomic) / 10_000n;
  return new Intl.NumberFormat("ko-KR").format(Number(value)) + "원";
}
