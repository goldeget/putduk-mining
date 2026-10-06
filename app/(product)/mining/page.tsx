import type { CSSProperties } from "react";
import Link from "next/link";

import { FundedRuntimeSummary } from "@/components/product/funded-runtime-summary";
import { RouteReloadButton } from "@/components/product/route-reload-button";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  MiningAmountBoard,
  miningDisplayedValue,
} from "@/components/product/mining-amount-board";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
import { MiningLiveStage } from "@/components/mining-live/mining-live-stage";
import { requirePageUser } from "@/lib/auth/session";
import { resolveDefaultStageInput } from "@/lib/mining-scene/default-stage";
import {
  formatMiningClock,
  formatMiningElapsed,
  presentMiningStatus,
  isConfirmedMiningRunning,
} from "@/lib/product/mining-display";
import {
  parseMiningServerDisplay,
  presentMiningServerDisplay,
  resolveFundedRuntimeStatus,
} from "@/lib/product/mining-server-display";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";
import miningStyles from "./page.module.css";

const worldColors: Record<string, string> = {
  CRYPTO: "var(--world-crypto)",
  GOLD: "var(--world-gold)",
  KOREA: "var(--world-korea)",
  SILVER: "var(--world-silver)",
  USA: "var(--world-usa)",
};

const worldDescriptions: Record<string, string> = {
  CRYPTO: "디지털 자산 테마를 담은 채굴 월드",
  GOLD: "금빛 광맥과 깊은 채굴감을 담은 월드",
  KOREA: "퍼뜩의 첫 여정이 시작되는 기본 채굴 월드",
  SILVER: "차분한 금속성과 정밀한 흐름을 담은 월드",
  USA: "넓은 스케일과 역동성을 담은 채굴 월드",
};

export default async function MiningPage() {
  const identity = await requirePageUser("/mining");
  const [
    { data: sessions, error: sessionsError },
    { data: worlds, error: worldsError },
    displayResponse,
  ] = await Promise.all([
    identity.supabase
      .from("mining_active_session_snapshots")
      .select(
        "mining_session_id, world_code, world_name_ko, status, started_at, last_settled_at, unsettled_seconds, active_equipment_count",
      )
      .eq("user_id", identity.userId)
      .order("started_at", { ascending: false }),
    identity.supabase
      .from("asset_worlds")
      .select("code, display_name_ko")
      .order("sort_order"),
    readOwnMiningServerDisplay(identity),
  ]);
  const parsedDisplay = displayResponse.error
    ? null
    : parseMiningServerDisplay(displayResponse.data);
  // 본문이 없는 성공은 빈 상태다. 본문이 있는데 읽지 못할 때만 오류다.
  const displayUnreadable =
    displayResponse.data != null && !displayResponse.error && !parsedDisplay;
  const displayError = Boolean(displayResponse.error) || displayUnreadable;
  const displayView = parsedDisplay
    ? presentMiningServerDisplay(parsedDisplay)
    : null;
  const amountBoard = {
    error: displayError,
    view: displayView,
  };
  const currentSession = sessions?.[0];
  const currentStatus = currentSession
    ? presentMiningStatus(currentSession.status)
    : null;
  const fundedRuntime = parsedDisplay?.funded_runtime;
  const fundedStatus = resolveFundedRuntimeStatus(fundedRuntime);
  const fundedLabel =
    fundedStatus === "ACTIVE"
      ? "채굴 중"
      : fundedStatus === "STOPPED"
        ? fundedRuntime?.schema_version === 2 &&
          fundedRuntime.stop_reason === "CAPACITY_USED"
          ? "이번 한도 완료"
          : "배분 대기"
        : "상태 확인 중";

  return (
    <div
      className={`${styles.worldPage} ${miningStyles.page}`}
      data-ui-ready="/mining"
      data-ui-state={
        sessionsError && worldsError && displayError
          ? "error"
          : sessionsError || worldsError || displayError
            ? "partial"
            : !sessions?.length && !fundedRuntime
              ? "empty"
              : "loaded"
      }
    >
      <PageHeading
        eyebrow="채굴"
        title="채굴 월드"
        lead="앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요."
      />

      {sessionsError ? (
        <>
          <StatePanel
            tone="error"
            title="채굴 상태를 불러오지 못했어요"
            description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 화면을 닫아도 채굴은 계속돼요."
          />
          <MiningAmountBoard {...amountBoard} placement="stack" />
        </>
      ) : (
        <>
          <MiningLiveStage
            scene={resolveDefaultStageInput()}
            running={
              displayError
                ? false
                : fundedRuntime
                  ? fundedStatus === "ACTIVE"
                  : isConfirmedMiningRunning(currentSession?.status)
            }
          >
            <div className={miningStyles.sceneCaption}>
              <header className={miningStyles.captionCard}>
                <div className={miningStyles.meta}>
                  {displayError ? (
                    <ProductStatusPill label="상태 확인 중" tone="neutral" />
                  ) : fundedRuntime ? (
                    <ProductStatusPill
                      label={fundedLabel}
                      tone={fundedStatus === "ACTIVE" ? "success" : "neutral"}
                    />
                  ) : currentStatus ? (
                    <ProductStatusPill
                      label={currentStatus.label}
                      tone={currentStatus.tone}
                    />
                  ) : (
                    <ProductStatusPill label="시작 전" tone="neutral" />
                  )}
                </div>
                <h2 id="world-hero-title">
                  {displayError
                    ? "채굴 상태를 다시 확인해 주세요"
                    : fundedRuntime
                      ? `실제 채굴 · ${fundedLabel}`
                      : currentSession
                        ? `${currentSession.world_name_ko} · ${currentStatus?.label ?? "상태 확인 중"}`
                        : "첫 월드에서 채굴을 시작해 보세요"}
                </h2>
                <p className={miningStyles.description}>
                  {displayError
                    ? "기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요."
                    : fundedRuntime
                      ? fundedStatus === "ACTIVE"
                        ? "확인된 원금 배분으로 채굴하고 있어요. 확정된 금액은 지갑에서 확인해 주세요."
                        : fundedStatus === "STOPPED"
                          ? "원금과 확정된 기록은 그대로예요. 배분과 채굴 한도를 확인해 주세요."
                          : "채굴 기록은 확인됐어요. 현재 상태는 다시 확인해 주세요."
                      : currentSession
                        ? "정산된 금액은 지갑에서 확인할 수 있어요."
                        : "PUTDUK START로 첫 채굴을 시작해 보세요."}
                </p>
              </header>
            </div>
          </MiningLiveStage>
          <section className={miningStyles.below} aria-label="채굴 현황">
            <div className={miningStyles.metrics}>
              <MiningAmountBoard {...amountBoard} placement="lead" />
              <MiningAmountBoard {...amountBoard} placement="follow" />
            </div>
            {displayError ? (
              <div className={miningStyles.actions}>
                <RouteReloadButton label="채굴 상태 다시 확인" />
              </div>
            ) : fundedRuntime ? (
              <div className={miningStyles.actions}>
                <Link
                  className="button button--primary"
                  href="/products/allocation"
                >
                  채굴 배분 확인
                  <PutdukIcon name="arrow-right" size={18} />
                </Link>
              </div>
            ) : currentSession ? (
              <div className={miningStyles.facts}>
                <span>
                  정산 전 경과{" "}
                  <strong>
                    {formatMiningElapsed(currentSession.unsettled_seconds)}
                  </strong>
                </span>
                <span>
                  활성 장비{" "}
                  <strong>{currentSession.active_equipment_count}개</strong>
                </span>
                <span>
                  최근 정산{" "}
                  <strong>
                    {formatMiningClock(currentSession.last_settled_at)}
                  </strong>
                </span>
              </div>
            ) : (
              <div className={miningStyles.actions}>
                <Link className="button button--primary" href="/start">
                  PUTDUK START 확인
                  <PutdukIcon name="arrow-right" size={18} />
                </Link>
              </div>
            )}
          </section>
        </>
      )}

      {parsedDisplay?.funded_runtime ? (
        <FundedRuntimeSummary runtime={parsedDisplay.funded_runtime} />
      ) : null}

      <details className={miningStyles.details} id="putduk-mining-details">
        <summary className={miningStyles.summary}>채굴 상세</summary>
        <div className={miningStyles.detailContent}>
          {displayView?.state === "ready" ? (
            <dl className={styles.sessionFacts} aria-label="채굴 기간">
              <div>
                <dt>기간</dt>
                <dd>{miningDisplayedValue(displayView, "기간")}</dd>
              </div>
            </dl>
          ) : null}
          {sessions?.length ? (
            <>
              <header className={styles.sectionHeader}>
                <span>
                  <p className="eyebrow">현재 상태</p>
                  <h2>현재 채굴 상태</h2>
                </span>
                <p>지금 보이는 상태예요. 금액은 정산 후 지갑에서 확인하세요.</p>
              </header>
              <section
                className={styles.sessionList}
                aria-label="현재 채굴 세션"
              >
                {sessions.map((session) => {
                  const status = presentMiningStatus(session.status);
                  return (
                    <article
                      className={styles.sessionCard}
                      key={session.mining_session_id}
                    >
                      <header className={styles.sessionCardHeader}>
                        <span>
                          <small>{session.world_code}</small>
                          <h3>{session.world_name_ko}</h3>
                        </span>
                        <ProductStatusPill
                          label={status.label}
                          tone={status.tone}
                        />
                      </header>
                      <dl className={styles.sessionFacts}>
                        <div>
                          <dt>정산 전 경과</dt>
                          <dd>
                            {formatMiningElapsed(session.unsettled_seconds)}
                          </dd>
                        </div>
                        <div>
                          <dt>활성 장비</dt>
                          <dd>{session.active_equipment_count}개</dd>
                        </div>
                        <div>
                          <dt>시작 시각</dt>
                          <dd>{formatMiningClock(session.started_at)}</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </section>
            </>
          ) : null}

          <header className={styles.sectionHeader}>
            <span>
              <p className="eyebrow">월드</p>
              <h2>월드 목록</h2>
            </span>
            <p>월드는 채굴 테마예요. 시세나 투자 수익을 따르지 않습니다.</p>
          </header>

          {worldsError ? (
            <StatePanel
              tone="error"
              title="월드 목록을 불러오지 못했어요"
              description="잠시 후 다시 확인해 주세요."
            />
          ) : worlds?.length ? (
            <section className={styles.worldGrid} aria-label="채굴 월드 목록">
              {worlds.map((world, index) => {
                const active = sessions?.some(
                  (session) => session.world_code === world.code,
                );
                return (
                  <article
                    className={styles.worldCard}
                    key={world.code}
                    style={
                      {
                        "--world-accent":
                          worldColors[world.code] ?? "var(--brand-primary)",
                      } as CSSProperties
                    }
                  >
                    <span className={styles.worldOrb} aria-hidden="true" />
                    <span>
                      <small>
                        {String(index + 1).padStart(2, "0")} · {world.code}
                      </small>
                      <h3>{world.display_name_ko}</h3>
                      <p>
                        {active
                          ? "현재 활성 세션이 이어지고 있어요."
                          : (worldDescriptions[world.code] ??
                            "퍼뜩의 채굴 테마 월드")}
                      </p>
                    </span>
                  </article>
                );
              })}
            </section>
          ) : (
            <StatePanel
              title="표시할 월드가 아직 없어요"
              description="이용 가능한 월드가 준비되면 이곳에서 확인할 수 있어요."
            />
          )}
        </div>
      </details>
    </div>
  );
}
