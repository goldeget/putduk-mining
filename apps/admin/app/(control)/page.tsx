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
    deposits,
    withdrawals,
    settlementErrors,
    notificationErrors,
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
      .in("status", ["REQUESTED", "REVIEWING", "APPROVED", "PROCESSING"]),
    db
      .from("mining_settlements")
      .select("id", { count: "exact", head: true })
      .eq("status", "FAILED"),
    db
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "FAILED"),
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
    ["KYC", "신원 확인", kyc, "법적·위험 검토가 필요한 건"],
    ["DEPOSIT", "입금 확인", deposits, "수동 계좌이체 확인 대기"],
    ["WITHDRAWAL", "출금 처리", withdrawals, "승인 또는 처리 중인 요청"],
    ["SETTLEMENT", "정산 예외", settlementErrors, "자동 정산 실패 건"],
    [
      "NOTIFICATION",
      "알림 실패",
      notificationErrors,
      "전달 재확인이 필요한 건",
    ],
  ] as const;
  const totalKnown = attention.every(
    ([, , result]) => !result.error && result.count !== null,
  )
    ? attention.reduce((sum, [, , result]) => sum + (result.count ?? 0), 0)
    : null;

  return (
    <>
      <section className="hero-console">
        <div>
          <p className="eyebrow">TODAY · KST</p>
          <h1>오늘의 퍼뜩</h1>
          <p>우선 확인이 필요한 운영 항목을 한 화면에 모았습니다.</p>
        </div>
        <div className="attention-orbit">
          <span>지금 확인할 일</span>
          <strong>{totalKnown ?? "—"}</strong>
          <small>
            {totalKnown === null ? "일부 조회 확인 필요" : "운영 예외 합계"}
          </small>
        </div>
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">OPERATOR QUEUE</p>
          <h2>오늘 확인할 일</h2>
        </div>
        <span>요청 시점 조회</span>
      </section>
      <section className="attention-grid" aria-label="운영 확인 항목">
        {attention.map(([code, label, result, description], index) => (
          <article
            key={code}
            className={
              result.error
                ? "attention-card attention-card--unknown"
                : "attention-card"
            }
          >
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <small>{code}</small>
            </header>
            <strong>{showCount(result)}</strong>
            <h3>{label}</h3>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="operations-grid">
        <article className="signal-panel">
          <header>
            <div>
              <p className="eyebrow">REQUEST SNAPSHOT</p>
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
            이 화면을 연 시점에 조회된 요약입니다. 자동화 성공 여부와 시스템
            상태는 검증 가능한 운영 신호가 연결된 뒤 별도로 표시합니다.
          </p>
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
