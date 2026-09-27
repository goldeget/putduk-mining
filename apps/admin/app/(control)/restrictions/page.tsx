import { formatKst, shortId } from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { SafeModeForm } from "./safe-mode-form";

const COMPONENT_LABEL: Record<string, string> = {
  GLOBAL: "전체",
  SIGNUP: "가입",
  TRIAL: "퍼뜩 시작",
  NEW_MINING: "새 채굴",
  SETTLEMENT: "정산",
  DEPOSIT: "입금",
  WITHDRAWAL: "출금",
  REFERRAL_PAYOUT: "추천 지급",
  EVENT_PAYOUT: "이벤트 지급",
  NOTIFICATION: "알림",
  AI: "AI",
};

export default async function RestrictionsPage() {
  await requireAdminPage("/restrictions");
  const db = createAdminServiceClient();

  const [safeMode, blocks, flags] = await Promise.all([
    db
      .from("safe_mode_controls")
      .select("id, component, is_paused, reason, starts_at, changed_by")
      .order("component"),
    db
      .from("block_rules")
      .select("id, scope, user_id, reason, source, starts_at, ends_at")
      .order("starts_at", { ascending: false })
      .limit(20),
    db
      .from("risk_flags")
      .select("id, user_id, flag_code, severity, created_at, resolved_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const safeRows = safeMode.data ?? [];
  const knownComponents = Object.keys(COMPONENT_LABEL);
  const byComponent = new Map(safeRows.map((r) => [r.component, r]));

  return (
    <>
      <QueueShell
        eyebrow="RESTRICTIONS · SAFE MODE"
        lead="기능 제한과 위험 신호를 확인합니다. 사유와 결과를 남기고, 회원으로 가장하지 않습니다."
        title="제한 · 안전 모드"
      />

      {(safeMode.error || blocks.error || flags.error) && (
        <p className="queue-flash" role="alert">
          일부 제한 정보를 불러오지 못했습니다.
        </p>
      )}

      <section className="section-heading">
        <div>
          <p className="eyebrow">SAFE MODE</p>
          <h2>기능 일시 정지</h2>
        </div>
      </section>

      <section className="queue-list" aria-label="안전 모드">
        {knownComponents.map((component) => {
          const row = byComponent.get(component);
          const paused = Boolean(row?.is_paused);
          return (
            <QueueCard key={component} tone={paused ? "caution" : "default"}>
              <header className="queue-card__head">
                <div>
                  <p className="eyebrow">{component}</p>
                  <h2>{COMPONENT_LABEL[component] ?? component}</h2>
                </div>
                <strong>{paused ? "정지 중" : "정상"}</strong>
              </header>
              {row ? (
                <p className="panel-note">
                  {row.reason} · {formatKst(row.starts_at)}
                </p>
              ) : (
                <p className="panel-note">아직 기록이 없습니다.</p>
              )}
              <SafeModeForm component={component} currentlyPaused={paused} />
            </QueueCard>
          );
        })}
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">BLOCKS</p>
          <h2>적용 중 제한</h2>
        </div>
      </section>

      {!blocks.error && (blocks.data?.length ?? 0) === 0 ? (
        <EmptyQueue body="활성 제한 규칙이 없습니다." title="제한 없음" />
      ) : null}

      <section className="queue-list" aria-label="제한 규칙">
        {(blocks.data ?? []).map((row) => (
          <QueueCard key={row.id}>
            <header className="queue-card__head">
              <div>
                <p className="eyebrow">{row.scope}</p>
                <h2>{row.reason}</h2>
              </div>
              <span>{formatKst(row.starts_at)}</span>
            </header>
            <dl className="evidence-grid">
              <div>
                <dt>출처</dt>
                <dd>{row.source}</dd>
              </div>
              <div>
                <dt>회원</dt>
                <dd>{row.user_id ? shortId(row.user_id) : "—"}</dd>
              </div>
              <div>
                <dt>종료</dt>
                <dd>{row.ends_at ? formatKst(row.ends_at) : "기한 없음"}</dd>
              </div>
            </dl>
          </QueueCard>
        ))}
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">RISK FLAGS</p>
          <h2>열린 위험 신호</h2>
        </div>
      </section>

      {!flags.error && (flags.data?.length ?? 0) === 0 ? (
        <EmptyQueue body="열린 위험 신호가 없습니다." title="위험 신호 없음" />
      ) : null}

      <section className="queue-list" aria-label="위험 신호">
        {(flags.data ?? []).map((row) => (
          <QueueCard key={row.id} tone="caution">
            <header className="queue-card__head">
              <div>
                <p className="eyebrow">{row.flag_code}</p>
                <h2>{row.severity}</h2>
              </div>
              <span>{formatKst(row.created_at)}</span>
            </header>
            <p className="panel-note">
              회원 {row.user_id ? shortId(row.user_id) : "—"} · 증거 원문은
              표시하지 않습니다.
            </p>
          </QueueCard>
        ))}
      </section>
    </>
  );
}
