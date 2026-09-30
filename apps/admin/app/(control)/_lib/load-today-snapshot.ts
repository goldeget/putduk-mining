import "server-only";

import { createAdminServiceClient } from "@/lib/supabase/service";

import {
  buildTodaySnapshot,
  type AuditEntry,
  type CountSource,
  type TodaySnapshot,
} from "./today-snapshot";

type HeadCountResult = {
  count: number | null;
  error: { message: string } | null;
};

function asCountSource(result: HeadCountResult): CountSource {
  return {
    count: result.count,
    error: result.error ? { message: result.error.message } : null,
  };
}

/**
 * 오늘의 퍼뜩 읽기 모형 조회.
 * service_role은 서버에서만 사용하며, 실패 시 숫자를 꾸며내지 않는다.
 */
export async function loadTodaySnapshot(
  observedAt: Date = new Date(),
): Promise<TodaySnapshot> {
  const db = createAdminServiceClient();
  const [
    kyc,
    usdtDeposits,
    krwWithdrawals,
    usdtWithdrawals,
    mismatches,
    failedJobs,
    safePaused,
    users,
    trials,
    audits,
  ] = await Promise.all([
    db
      .from("kyc_cases")
      .select("id", { count: "exact", head: true })
      .in("status", [
        "PENDING",
        "IN_REVIEW",
        "ON_HOLD",
        "REQUIRES_RESUBMISSION",
      ]),
    // USDT 입금 확인 대기열은 canonical usdt_manual_deposits(SUBMITTED)만 센다.
    db
      .from("usdt_manual_deposits")
      .select("id", { count: "exact", head: true })
      .eq("status", "SUBMITTED"),
    db
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("destination_type", "KRW_BANK")
      .in("status", ["REQUESTED", "REVIEWING", "APPROVED", "PROCESSING"]),
    db
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("destination_type", "USDT_ADDRESS")
      .in("status", ["REQUESTED", "REVIEWING", "APPROVED", "PROCESSING"]),
    db
      .from("reconciliation_mismatches")
      .select("id", { count: "exact", head: true })
      .in("status", ["OPEN", "INVESTIGATING"]),
    db
      .from("system_jobs")
      .select("id", { count: "exact", head: true })
      .or("status.eq.FAILED,dead_lettered_at.not.is.null"),
    db
      .from("safe_mode_controls")
      .select("id", { count: "exact", head: true })
      .eq("is_paused", true),
    db.from("user_profiles").select("user_id", { count: "exact", head: true }),
    db
      .from("trial_accounts")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE"),
    db
      .from("audit_logs")
      .select("id, action, target_type, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const auditRows: AuditEntry[] | null = audits.error
    ? null
    : (audits.data ?? []).map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        reason: row.reason ?? null,
        createdAt: row.created_at,
      }));

  return buildTodaySnapshot({
    usdtDeposits: asCountSource(usdtDeposits),
    krwWithdrawals: asCountSource(krwWithdrawals),
    usdtWithdrawals: asCountSource(usdtWithdrawals),
    kyc: asCountSource(kyc),
    mismatches: asCountSource(mismatches),
    failedJobs: asCountSource(failedJobs),
    safePaused: asCountSource(safePaused),
    users: asCountSource(users),
    trials: asCountSource(trials),
    audits: { error: audits.error, data: auditRows },
    observedAt,
  });
}
