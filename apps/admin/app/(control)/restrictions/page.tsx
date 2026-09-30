import Link from "next/link";
import type { Route } from "next";

import { formatKst, shortId } from "@/app/(control)/_lib/format";
import { EmptyQueue, QueueCard, QueueShell } from "@/components/queue-shell";
import { requireAdminPage } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { SafeModeForm } from "./safe-mode-form";
import {
  canMutateSafeMode,
  COMPONENT_LABEL,
  SAFE_MODE_COMPONENTS,
  safeModeStateLabel,
  type SafeModeComponent,
} from "./safe-mode-policy";

export default async function RestrictionsPage() {
  const principal = await requireAdminPage("/restrictions");
  const canMutate = canMutateSafeMode(principal.role);
  const db = createAdminServiceClient();

  const [safeMode, blocks, flags] = await Promise.all([
    db
      .from("safe_mode_controls")
      .select(
        "id, component, is_paused, reason, starts_at, review_at, changed_by",
      )
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

  const safeRows = safeMode.error ? [] : (safeMode.data ?? []);
  const byComponent = new Map(safeRows.map((r) => [r.component, r]));
  const loadFailed = Boolean(safeMode.error || blocks.error || flags.error);
  const pausedCount = SAFE_MODE_COMPONENTS.filter((component) =>
    Boolean(byComponent.get(component)?.is_paused),
  ).length;

  return (
    <div
      data-ui-ready="/restrictions"
      data-ui-state={loadFailed ? "partial" : "loaded"}
    >
      <QueueShell
        eyebrow="제한 · 안전 모드"
        lead="기능을 잠시 멈추거나 위험 신호를 확인합니다. 사유와 감사 기록을 남깁니다."
        title="제한 · 안전 모드"
      />

      <p className="panel-note" role="note">
        안전 모드와 기능 플래그는 권한이 아닙니다. 역할과 본인 확인은 그대로
        적용됩니다.
      </p>

      {!canMutate ? (
        <p className="queue-flash" role="status">
          현재 역할로는 조회만 가능합니다. 제한 변경은 상위 운영자만 할 수
          있습니다.
        </p>
      ) : null}

      {loadFailed ? (
        <div className="queue-flash" role="alert">
          <p>일부 제한 정보를 불러오지 못했습니다.</p>
          <p className="panel-note">
            화면을 새로고침한 뒤에도 같으면 예외 화면에서 확인하세요.
          </p>
          <Link className="text-link" href={"/restrictions" as Route}>
            다시 불러오기
          </Link>
        </div>
      ) : null}

      <section className="section-heading">
        <div>
          <p className="eyebrow">기능 일시 정지</p>
          <h2>안전 모드</h2>
        </div>
        <span aria-live="polite">
          {safeMode.error
            ? "확인 불가"
            : pausedCount > 0
              ? `정지 ${pausedCount}건`
              : "전부 정상"}
        </span>
      </section>

      <section className="queue-list" aria-label="안전 모드">
        {SAFE_MODE_COMPONENTS.map((component) => {
          const row = byComponent.get(component);
          const paused = Boolean(row?.is_paused);
          return (
            <QueueCard key={component} tone={paused ? "caution" : "default"}>
              <header className="queue-card__head">
                <div>
                  <p className="eyebrow">{component}</p>
                  <h2>{COMPONENT_LABEL[component]}</h2>
                </div>
                <strong>
                  {safeMode.error ? "확인 불가" : safeModeStateLabel(paused)}
                </strong>
              </header>
              {row ? (
                <dl className="evidence-grid">
                  <div>
                    <dt>사유</dt>
                    <dd>{row.reason}</dd>
                  </div>
                  <div>
                    <dt>시작</dt>
                    <dd>{formatKst(row.starts_at)}</dd>
                  </div>
                  <div>
                    <dt>검토</dt>
                    <dd>
                      {row.review_at ? formatKst(row.review_at) : "기한 없음"}
                    </dd>
                  </div>
                  <div>
                    <dt>변경자</dt>
                    <dd>{row.changed_by ? shortId(row.changed_by) : "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="panel-note">
                  {safeMode.error
                    ? "현재 상태를 불러오지 못했습니다."
                    : "아직 기록이 없습니다."}
                </p>
              )}
              {safeMode.error ? (
                <p className="panel-note" role="alert">
                  현재 안전 모드를 확인한 뒤 변경할 수 있습니다.
                </p>
              ) : (
                <SafeModeForm
                  canMutate={canMutate}
                  component={component as SafeModeComponent}
                  currentlyPaused={paused}
                />
              )}
            </QueueCard>
          );
        })}
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">적용 중 제한</p>
          <h2>제한 규칙</h2>
        </div>
      </section>

      {!blocks.error && (blocks.data?.length ?? 0) === 0 ? (
        <EmptyQueue body="활성 제한 규칙이 없습니다." title="제한 없음" />
      ) : null}

      <section className="queue-list" aria-label="제한 규칙">
        {(blocks.error ? [] : (blocks.data ?? [])).map((row) => (
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
          <p className="eyebrow">위험 신호</p>
          <h2>열린 위험 신호</h2>
        </div>
      </section>

      {!flags.error && (flags.data?.length ?? 0) === 0 ? (
        <EmptyQueue body="열린 위험 신호가 없습니다." title="위험 신호 없음" />
      ) : null}

      <section className="queue-list" aria-label="위험 신호">
        {(flags.error ? [] : (flags.data ?? [])).map((row) => (
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
    </div>
  );
}
