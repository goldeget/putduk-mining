import Link from "next/link";
import type { Route } from "next";

import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

type CountResult = { count: number | null; error: { message: string } | null };
const showCount = ({ count, error }: CountResult) =>
  error || count === null ? "확인 필요" : count.toLocaleString("ko-KR");

export default async function TodayPage() {
  await requireAdminPage("/");
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
    db
      .from("deposit_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["REQUESTED", "AWAITING_TRANSFER", "REVIEWING"]),
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

  const attention = [
    {
      code: "USDT_DEPOSIT",
      label: "USDT 입금 확인",
      href: "/deposits/usdt" as Route,
      result: usdtDeposits,
      description: "외부 이체 확인 후 원화만 반영",
    },
    {
      code: "KRW_BANK",
      label: "계좌 출금",
      href: "/withdrawals/krw-bank" as Route,
      result: krwWithdrawals,
      description: "은행 송금·거절·원장 확정",
    },
    {
      code: "USDT_WD",
      label: "USDT 출금",
      href: "/withdrawals/usdt" as Route,
      result: usdtWithdrawals,
      description: "외부 송금 기록 후 원장만 확정",
    },
    {
      code: "KYC",
      label: "본인 확인",
      href: "/kyc" as Route,
      result: kyc,
      description: "승인·보류·재제출 결정",
    },
    {
      code: "EXCEPTION",
      label: "정산·대사 예외",
      href: "/exceptions" as Route,
      result: {
        count:
          mismatches.error || failedJobs.error
            ? null
            : (mismatches.count ?? 0) + (failedJobs.count ?? 0),
        error: mismatches.error ?? failedJobs.error,
      },
      description: "차이 확인 · 자동 수리 없음",
    },
    {
      code: "SAFE",
      label: "제한·안전 모드",
      href: "/restrictions" as Route,
      result: safePaused,
      description: "멈춘 기능과 위험 신호",
    },
  ] as const;

  const totalKnown = attention.every(
    ({ result }) => !result.error && result.count !== null,
  )
    ? attention.reduce((sum, { result }) => sum + (result.count ?? 0), 0)
    : null;

  const kstNow = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date());

  return (
    <>
      <section className="hero-console">
        <div>
          <p className="eyebrow">OPERATIONS BRIEFING · KST</p>
          <h1>오늘의 퍼뜩</h1>
          <p>지금 판단해야 할 일과 서비스 상태를 한 화면에 모았습니다.</p>
          <small className="hero-meta">{kstNow}</small>
        </div>
        <div className="attention-orbit">
          <span>지금 확인할 일</span>
          <strong>{totalKnown ?? "—"}</strong>
          <small>
            {totalKnown === null ? "일부 조회 확인 필요" : "대기열 합계"}
          </small>
        </div>
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">PRIORITY QUEUE</p>
          <h2>오늘 확인할 일</h2>
        </div>
        <span>요청 시점 조회</span>
      </section>
      <section className="attention-grid attention-grid--six" aria-label="운영 확인 항목">
        {attention.map((item, index) => (
          <Link
            key={item.code}
            className={
              item.result.error
                ? "attention-card attention-card--unknown"
                : "attention-card attention-card--link"
            }
            href={item.href}
          >
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <small>{item.code}</small>
            </header>
            <strong>{showCount(item.result)}</strong>
            <h3>{item.label}</h3>
            <p>{item.description}</p>
          </Link>
        ))}
      </section>

      <section className="operations-grid">
        <article className="signal-panel">
          <header>
            <div>
              <p className="eyebrow">SERVICE SNAPSHOT</p>
              <h2>현재 조회 요약</h2>
            </div>
            <span className="live-chip">조회 시점</span>
          </header>
          <div className="pulse-metrics">
            <div>
              <span>전체 회원</span>
              <strong>{showCount(users)}</strong>
            </div>
            <div>
              <span>진행 중 START</span>
              <strong>{showCount(trials)}</strong>
            </div>
            <div>
              <span>확인된 예외</span>
              <strong>{totalKnown ?? "—"}</strong>
            </div>
          </div>
          <p className="panel-note">
            Basic Mode입니다. 기술 용어 없이 대기열로 바로 이동합니다. Member
            360에서 회원 맥락을 확인하세요.
          </p>
          <Link className="text-link" href={"/members" as Route}>
            Member 360 열기
          </Link>
        </article>
        <article className="audit-panel">
          <header>
            <p className="eyebrow">IMMUTABLE AUDIT</p>
            <h2>최근 운영 기록</h2>
          </header>
          {audits.error ? (
            <p className="empty-state">감사 기록을 확인할 수 없습니다.</p>
          ) : audits.data?.length ? (
            <ol>
              {audits.data.map((entry) => (
                <li key={entry.id}>
                  <span>{entry.target_type}</span>
                  <strong>{entry.action}</strong>
                  <time dateTime={entry.created_at}>
                    {new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(entry.created_at))}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">아직 생성된 감사 기록이 없습니다.</p>
          )}
        </article>
      </section>
    </>
  );
}
