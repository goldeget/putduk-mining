import { DepositApprovalForm } from "@/components/admin/deposit-approval-form";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import type { DisplayCurrency } from "@/domain/wallet/format-amount";
import { requireAdminPage } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

function displayCount(result: CountResult) {
  return result.error || result.count === null
    ? "UNKNOWN"
    : String(result.count);
}

function stateFromCount(result: CountResult, activeLabel: string) {
  if (result.error || result.count === null) {
    return { label: "확인 불가", tone: "unknown" };
  }
  if (result.count === 0) {
    return { label: "미구성", tone: "pending" };
  }
  return { label: activeLabel, tone: "ready" };
}

export default async function AdminDashboardPage() {
  const operator = await requireAdminPage();
  const supabase = createSupabaseAdminClient();
  const [
    users,
    activeTrials,
    activeMining,
    pendingDeposits,
    pendingWithdrawals,
    enabledTrialPrograms,
    worldRuleVersions,
    publishedEvents,
    systemComponents,
    recentAudits,
    pendingDepositRows,
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true }),
    supabase
      .from("trial_accounts")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE"),
    supabase
      .from("mining_sessions")
      .select("id", { count: "exact", head: true })
      .is("ended_at", null),
    supabase
      .from("deposit_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["REQUESTED", "AWAITING_TRANSFER", "REVIEWING"]),
    supabase
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["REQUESTED", "REVIEWING", "APPROVED", "PROCESSING"]),
    supabase
      .from("trial_programs")
      .select("id", { count: "exact", head: true })
      .eq("is_enabled", true),
    supabase
      .from("world_rule_versions")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("status", "PUBLISHED"),
    supabase.from("system_status").select("id", { count: "exact", head: true }),
    supabase
      .from("audit_logs")
      .select("id, action, target_type, reason, actor_role, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("deposit_requests")
      .select("id, user_id, currency, amount_atomic, status, requested_at")
      .in("status", ["REQUESTED", "AWAITING_TRANSFER", "REVIEWING"])
      .order("requested_at", { ascending: true })
      .limit(10),
  ]);

  const operations = [
    { label: "가입 사용자", value: displayCount(users), icon: "user" as const },
    {
      label: "진행 중 체험",
      value: displayCount(activeTrials),
      icon: "clock" as const,
    },
    {
      label: "활성 채굴 세션",
      value: displayCount(activeMining),
      icon: "mining" as const,
    },
    {
      label: "확인 대기 입금",
      value: displayCount(pendingDeposits),
      icon: "wallet" as const,
    },
    {
      label: "처리 중 출금",
      value: displayCount(pendingWithdrawals),
      icon: "arrow-right" as const,
    },
  ];

  const configuration = [
    {
      key: "TRIAL PROGRAM",
      title: "PUTDUK START 규칙",
      ...stateFromCount(enabledTrialPrograms, "활성 버전 존재"),
    },
    {
      key: "ECONOMY RULES",
      title: "월드 경제 규칙",
      ...stateFromCount(worldRuleVersions, "버전 존재"),
    },
    {
      key: "LIVE OPERATIONS",
      title: "공개 이벤트",
      ...stateFromCount(publishedEvents, "게시 중"),
    },
    {
      key: "SYSTEM STATUS",
      title: "시스템 상태 관측",
      ...stateFromCount(systemComponents, "관측 중"),
    },
  ];

  return (
    <>
      <section className="admin-heading" id="overview">
        <div>
          <p className="eyebrow">OPERATIONS OVERVIEW</p>
          <h1>운영 사실만 보여주는 컨트롤 플레인.</h1>
          <p>
            값이 없으면 0, 조회할 수 없으면 UNKNOWN으로 표시합니다. 준비되지
            않은 구성을 정상 상태처럼 추정하지 않습니다.
          </p>
        </div>
        <span className="admin-heading__mode">READ-MOSTLY FOUNDATION</span>
      </section>

      <section className="admin-metrics" aria-label="운영 지표">
        {operations.map((metric) => (
          <article key={metric.label}>
            <PutdukIcon name={metric.icon} size={19} />
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>

      <section className="admin-grid" id="system">
        <article className="admin-panel admin-panel--wide">
          <header>
            <div>
              <p className="eyebrow">CONFIGURATION GATES</p>
              <h2>출시 전 활성 구성</h2>
            </div>
            <span>LIVE QUERY</span>
          </header>
          <div className="admin-gate-list">
            {configuration.map((item) => (
              <div key={item.key}>
                <span>
                  <small>{item.key}</small>
                  <strong>{item.title}</strong>
                </span>
                <em className={`admin-state admin-state--${item.tone}`}>
                  {item.label}
                </em>
              </div>
            ))}
          </div>
        </article>

        <article className="admin-panel" id="operations">
          <header>
            <div>
              <p className="eyebrow">SAFETY MODEL</p>
              <h2>고위험 작업 경계</h2>
            </div>
          </header>
          <ul className="admin-boundaries">
            <li>경제 규칙은 초안·시뮬레이션·승인·미래 적용 시점을 거칩니다.</li>
            <li>입출금 승인은 원장 이벤트와 감사 로그를 함께 남깁니다.</li>
            <li>
              권한 변경과 관리자 조정은 사유 없는 실행을 허용하지 않습니다.
            </li>
          </ul>
        </article>

        <article className="admin-panel admin-panel--wide" id="assets">
          <header>
            <div>
              <p className="eyebrow">FUNDING REVIEW</p>
              <h2>입금 확인 대기</h2>
            </div>
            <span>
              {pendingDepositRows.error ? "QUERY FAILED" : "OLDEST FIRST"}
            </span>
          </header>
          {pendingDepositRows.error ? (
            <p className="admin-empty">입금 요청을 조회할 수 없습니다.</p>
          ) : pendingDepositRows.data?.length ? (
            <div className="admin-deposit-list">
              {pendingDepositRows.data.map((request) => (
                <article key={request.id}>
                  <div>
                    <span>{request.status}</span>
                    <strong>
                      {request.currency} / {request.amount_atomic}
                    </strong>
                    <small>USER {request.user_id.slice(0, 8)}…</small>
                  </div>
                  <time dateTime={request.requested_at}>
                    {new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(request.requested_at))}
                  </time>
                  {["SUPER_ADMIN", "ADMIN"].includes(operator.role) ? (
                    <DepositApprovalForm
                      amountAtomic={String(request.amount_atomic)}
                      currency={request.currency as DisplayCurrency}
                      requestId={request.id}
                    />
                  ) : (
                    <span className="admin-state admin-state--pending">
                      VIEW ONLY
                    </span>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">확인 대기 중인 입금 요청이 없습니다.</p>
          )}
        </article>

        <article className="admin-panel admin-panel--wide" id="ai-trust">
          <header>
            <div>
              <p className="eyebrow">AUDIT STREAM</p>
              <h2>최근 감사 기록</h2>
            </div>
            <span>{recentAudits.error ? "QUERY FAILED" : "APPEND ONLY"}</span>
          </header>
          {recentAudits.error ? (
            <p className="admin-empty">감사 기록을 조회할 수 없습니다.</p>
          ) : recentAudits.data?.length ? (
            <div className="admin-audit-list">
              {recentAudits.data.map((entry) => (
                <div key={entry.id}>
                  <span>
                    <small>{entry.target_type}</small>
                    <strong>{entry.action}</strong>
                  </span>
                  <p>{entry.reason}</p>
                  <time dateTime={entry.created_at}>
                    {new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(entry.created_at))}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <p className="admin-empty">아직 생성된 감사 기록이 없습니다.</p>
          )}
        </article>
      </section>

      <section className="admin-domain-map" id="users">
        <p className="eyebrow">DOMAIN OWNERSHIP</p>
        <h2>관리 범위를 도메인별로 분리합니다.</h2>
        <div>
          {[
            ["Identity", "사용자 · 권한", "users"],
            ["Trial", "체험 프로그램 · 곡선", "trial"],
            ["Mining", "월드 · 세션 · 정산", "mining"],
            ["Economy", "규칙 버전 · 적용 시점", "economy"],
            ["Assets", "원장 · 입금 · 출금", "assets"],
            ["LiveOps", "이벤트 · 공지 · 알림", "operations"],
            ["AI / Trust", "지식 · 사실 · 공개 문서", "ai-trust"],
            ["System", "작업 · 상태 · 감사", "system"],
          ].map(([name, description, anchor]) => (
            <a href={`/admin#${anchor}`} key={name}>
              <span>{name}</span>
              <strong>{description}</strong>
              <PutdukIcon name="arrow-right" size={17} />
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
