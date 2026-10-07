import type { CSSProperties } from "react";
import Link from "next/link";

import { MiningReferenceScene } from "@/components/mining-live/mining-reference-scene";
import { MiningLiveStage } from "@/components/mining-live/mining-live-stage";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { FundedRuntimeSummary } from "@/components/product/funded-runtime-summary";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { RouteReloadButton } from "@/components/product/route-reload-button";
import { StatePanel } from "@/components/ui/states";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import {
  formatWalletEvidenceTime,
  walletReceiptStatusLabels,
  labelWalletReceiptType,
} from "@/domain/wallet/wallet-read";
import { requirePageUser } from "@/lib/auth/session";
import { presentHomeCapacityProgress } from "@/lib/product/home-capacity-progress";
import {
  isConfirmedMiningRunning,
  formatMiningClock,
  formatMiningElapsed,
  presentMiningStatus,
} from "@/lib/product/mining-display";
import {
  presentMiningTrial,
  presentMiningReferenceFacts,
  resolveMiningPresentation,
} from "@/lib/product/mining-presentation";
import { parseMiningServerDisplay } from "@/lib/product/mining-server-display";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";
import { readMemberSceneBinding } from "@/lib/product/read-member-scene-binding.server";
import { projectStageInput } from "@/lib/mining-scene/stage-input";

import styles from "./page.module.css";

const worldDescriptions: Record<string, string> = {
  CRYPTO: "디지털 자산 테마를 담은 채굴 월드",
  GOLD: "금빛 광맥과 깊은 채굴감을 담은 월드",
  KOREA: "퍼뜩의 첫 여정이 시작되는 기본 채굴 월드",
  SILVER: "차분한 금속성과 정밀한 흐름을 담은 월드",
  USA: "넓은 스케일과 역동성을 담은 채굴 월드",
};

function MetalBrand() {
  return (
    <svg
      width="40"
      height="56"
      viewBox="0 0 40 56"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 10 21 1l16 8-18 9L3 10Z" fill="#ffe6a0" />
      <path d="M3 10v36l16 9V18L3 10Z" fill="#b98b3c" />
      <path d="m19 18 18-9v37l-18 9V18Z" fill="#f0c66c" />
      <path d="m10 14 7 4v32l-7-4V14Z" fill="#fbe7a9" />
      <path d="m24 20 7-4v26l-7 4V20Z" fill="#31240f" />
      <path d="m3 10 18-9 16 8v37l-18 9-16-9V10Z" stroke="#f8d88c" />
    </svg>
  );
}

/** Display only. Invalid or unsafe JSON numbers stay unknown instead of becoming money. */
function historyAmount(value: unknown, currency: unknown) {
  const atomic =
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
      ? value
      : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? String(value)
        : null;
  if (!atomic || (currency !== "KRW" && currency !== "USDT"))
    return "확인할 수 없어요";
  return formatAtomicAmount(atomic, currency).replace(/ KRW$/, "원");
}

function FactValue({ value }: { value: string }) {
  return (
    <span
      className={styles.value}
      data-mining-value={value.endsWith("원") ? "money" : "text"}
    >
      {value}
    </span>
  );
}

export default async function MiningPage() {
  const identity = await requirePageUser("/mining");
  const [
    { data: sessions, error: sessionsError },
    { data: worlds, error: worldsError },
    displayResponse,
    { data: krwAccount, error: accountError },
    { data: receipts, error: receiptsError },
    { data: trial, error: trialError },
    sceneBinding,
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
    identity.supabase
      .from("wallet_balance_snapshots")
      .select("wallet_account_id")
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .maybeSingle(),
    identity.supabase
      .from("transaction_receipts")
      .select(
        "id, receipt_number, transaction_type, amount_atomic, currency, status, requested_at, completed_at",
      )
      .eq("user_id", identity.userId)
      .order("requested_at", { ascending: false })
      .limit(5),
    identity.supabase
      .from("trial_account_snapshots")
      .select("status")
      .eq("user_id", identity.userId)
      .maybeSingle(),
    readMemberSceneBinding(identity),
  ]);
  const { data: rewardEntries, error: rewardError } =
    !accountError && krwAccount?.wallet_account_id
      ? await identity.supabase
          .from("wallet_ledger")
          .select("id, direction, entry_type, amount_atomic, created_at")
          .eq("user_id", identity.userId)
          .eq("wallet_account_id", krwAccount.wallet_account_id)
          .eq("entry_type", "MINING_REWARD")
          .eq("direction", "CREDIT")
          .order("created_at", { ascending: false })
          .limit(5)
      : { data: null, error: accountError };
  const display = displayResponse.error
    ? null
    : parseMiningServerDisplay(displayResponse.data);
  const displayError = Boolean(displayResponse.error) || !display;
  const currentSession = sessionsError ? null : sessions?.[0];
  const presentation = resolveMiningPresentation({
    display,
    displayError,
    session: currentSession,
    sessionError: Boolean(sessionsError),
  });
  const facts = presentMiningReferenceFacts(display, displayError);
  const capacityProgress = presentHomeCapacityProgress(display, displayError);
  const runtime = display?.funded_runtime;
  const selectedProduct =
    sceneBinding.state === "ready" ? sceneBinding.products[0] : null;
  // Confirmed allocation intent is not current-session or per-product accrual proof.
  const selectedArt = selectedProduct?.scene.productionAssetActive
    ? selectedProduct
    : null;
  const trialView = presentMiningTrial(trial?.status, Boolean(trialError));
  const hasFailedRead =
    displayError ||
    Boolean(
      sessionsError ||
      worldsError ||
      accountError ||
      receiptsError ||
      rewardError ||
      trialError,
    );
  const legacySessions = sessionsError ? [] : (sessions ?? []);

  return (
    <div
      className={styles.page}
      data-ui-ready="/mining"
      data-ui-state={
        displayError && sessionsError && worldsError
          ? "error"
          : hasFailedRead
            ? "partial"
            : presentation.source === "unknown"
              ? "unknown"
              : presentation.source === "empty"
                ? "empty"
                : "loaded"
      }
    >
      <section className={styles.controlRoom} aria-label="현재 채굴 현황">
        <div
          className={styles.hero}
          data-member-product-art={selectedArt?.code}
        >
          {selectedArt ? (
            <MiningLiveStage
              scene={projectStageInput(selectedArt.scene)}
              presentation="backdrop"
              className={styles.artwork}
              running={false}
            />
          ) : (
            <MiningReferenceScene
              running={presentation.running}
              className={styles.artwork}
            />
          )}
          <div className={styles.heroScrim} aria-hidden="true" />
          <header className={styles.heroCopy}>
            <div className={styles.brand}>
              <MetalBrand />
              <h1 aria-label="채굴 월드">퍼뜩 채굴</h1>
            </div>
            <p>
              작은 한 걸음이
              <br />더 큰 가치를 만듭니다.
            </p>
          </header>
        </div>

        <section className={styles.rail} aria-label="채굴 현황">
          <div className={styles.sceneCaption}>
            <ProductStatusPill
              label={presentation.label}
              tone={presentation.tone}
            />
            <h2 id="world-hero-title">{presentation.title}</h2>
            <p>{presentation.lead}</p>
            {selectedArt ? (
              <p data-member-scene-binding="confirmed-allocation">
                선택 상품 테마 · {selectedArt.nameKo}
              </p>
            ) : null}
          </div>
          <div className={styles.tierCard}>
            <PutdukHomeIcon name="crown" size={38} />
            <div>
              <span>현재 등급</span>
              <strong>{facts.tier}</strong>
              <small>확인된 채굴 원금 기준</small>
            </div>
            <Link href="/products" aria-label="채굴 상품 보기">
              <PutdukIcon name="arrow-right" size={18} />
            </Link>
          </div>
          <dl className={styles.mainFacts}>
            <div>
              <dt>
                <PutdukHomeIcon name="coins" size={35} />
                <span>채굴 원금</span>
              </dt>
              <dd>
                <FactValue value={facts.principal} />
              </dd>
            </div>
            <div>
              <dt>
                <PutdukHomeIcon name="chart" size={35} />
                <span>오늘 채굴</span>
              </dt>
              <dd>
                <FactValue value={facts.today} />
              </dd>
            </div>
          </dl>
          <section
            className={styles.capacity}
            aria-labelledby="mining-capacity-title"
          >
            <h2 id="mining-capacity-title">
              <PutdukHomeIcon name="capacity" size={25} />
              채굴 용량
            </h2>
            <dl>
              <div className={styles.capacityLead}>
                <dt>남은 한도</dt>
                <dd>
                  <FactValue value={facts.remaining} />
                </dd>
              </div>
              <div>
                <dt>사용한 한도</dt>
                <dd>{facts.used}</dd>
              </div>
              <div>
                <dt>이번 한도</dt>
                <dd>{facts.capacity}</dd>
              </div>
            </dl>
            {capacityProgress ? (
              <div className={styles.capacityProgress}>
                <progress
                  aria-label="채굴 한도 사용률"
                  aria-valuetext={capacityProgress.usedLabel}
                  max={10_000}
                  value={capacityProgress.usedBps}
                />
                <small>{capacityProgress.usedLabel}</small>
              </div>
            ) : null}
          </section>
          <div className={styles.speedCard}>
            <PutdukHomeIcon name="bolt" size={34} />
            <dl aria-label="채굴 속도" data-amount-weight="speed">
              <dt>
                {presentation.source === "funded" && !presentation.running
                  ? "설정된 속도"
                  : "현재 속도"}
              </dt>
              <dd>
                <FactValue value={facts.speed} />
              </dd>
            </dl>
            <p>
              {presentation.source === "funded" && !presentation.running
                ? "현재 채굴은 멈췄어요."
                : "채굴 속도에 적용하는 배수예요."}
            </p>
          </div>
          <div className={styles.actions}>
            {presentation.action === "reload" ? (
              <RouteReloadButton label="채굴 상태 다시 확인" />
            ) : presentation.action === "allocation" ? (
              <Link
                className="button button--primary"
                href="/products/allocation"
              >
                <PutdukHomeIcon name="bolt" size={22} metallic={false} />
                채굴 배분 확인
                <PutdukIcon name="arrow-right" size={19} />
              </Link>
            ) : presentation.action === "start" ? (
              <Link className="button button--primary" href="/start">
                PUTDUK START 확인
                <PutdukIcon name="arrow-right" size={19} />
              </Link>
            ) : (
              <Link className="button button--primary" href="/wallet">
                확정 금액 확인
                <PutdukIcon name="arrow-right" size={19} />
              </Link>
            )}
          </div>
          {presentation.source === "legacy" && currentSession ? (
            <dl className={styles.legacyFacts}>
              <div>
                <dt>정산 전 경과</dt>
                <dd>{formatMiningElapsed(currentSession.unsettled_seconds)}</dd>
              </div>
              <div>
                <dt>활성 장비</dt>
                <dd>{currentSession.active_equipment_count}개</dd>
              </div>
              <div>
                <dt>최근 정산</dt>
                <dd>{formatMiningClock(currentSession.last_settled_at)}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      </section>

      {sessionsError ? (
        <StatePanel
          tone="error"
          title="채굴 상태를 불러오지 못했어요"
          description="세션 기록을 다시 불러와 주세요."
          action={<RouteReloadButton label="세션 기록 다시 확인" />}
        />
      ) : null}
      {displayError ? (
        <StatePanel
          tone="error"
          title="채굴 금액을 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요. 확인하지 못한 금액은 표시하지 않아요."
        />
      ) : null}

      {presentation.source === "unknown" || presentation.source === "funded" ? (
        <section
          className={styles.trialCard}
          aria-labelledby="mining-start-title"
        >
          <div>
            <h2 id="mining-start-title">
              PUTDUK START{" "}
              <ProductStatusPill
                label={trialView.presentation.label}
                tone={trialView.presentation.tone}
              />
            </h2>
            <p>체험과 실제 채굴은 따로 표시해요.</p>
          </div>
          {trialView.known ? (
            <Link href="/start">
              {trialView.actionLabel}
              <PutdukIcon name="arrow-right" size={16} />
            </Link>
          ) : (
            <div
              className={styles.trialRecovery}
              role="group"
              aria-label={trialView.actionLabel}
            >
              <RouteReloadButton
                label="다시 확인"
                className="button button--secondary"
              />
            </div>
          )}
        </section>
      ) : null}

      <div className={styles.records}>
        <section
          className={styles.recordCard}
          aria-labelledby="mining-rewards-title"
        >
          <header>
            <h2 id="mining-rewards-title">
              <PutdukHomeIcon name="coins" size={24} />
              확정된 채굴 내역
            </h2>
            <Link href="/wallet?view=profit">
              전체 보기
              <PutdukIcon name="arrow-right" size={14} />
            </Link>
          </header>
          {accountError || rewardError ? (
            <div className={styles.recordState} role="status">
              <p>채굴 내역을 불러오지 못했어요.</p>
              <RouteReloadButton label="채굴 내역 다시 확인" />
            </div>
          ) : !krwAccount ? (
            <p className={styles.recordState}>
              표시할 채굴 지갑이 아직 없어요.
            </p>
          ) : rewardEntries?.length ? (
            <ul className={styles.history}>
              {rewardEntries.map((entry) => (
                <li key={entry.id}>
                  <time dateTime={entry.created_at}>
                    {formatWalletEvidenceTime(entry.created_at)}
                  </time>
                  <span>채굴 보상</span>
                  <strong>{historyAmount(entry.amount_atomic, "KRW")}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.recordState}>
              확정된 채굴 내역이 아직 없어요.
            </p>
          )}
        </section>
        <section
          className={styles.recordCard}
          aria-labelledby="mining-transactions-title"
        >
          <header>
            <h2 id="mining-transactions-title">
              <PutdukHomeIcon name="ledger" size={24} />
              최근 거래 내역
            </h2>
            <Link href="/wallet?view=history">
              전체 보기
              <PutdukIcon name="arrow-right" size={14} />
            </Link>
          </header>
          {receiptsError ? (
            <div className={styles.recordState} role="status">
              <p>거래 내역을 불러오지 못했어요.</p>
              <RouteReloadButton label="거래 내역 다시 확인" />
            </div>
          ) : receipts?.length ? (
            <ul className={styles.history}>
              {receipts.map((receipt) => (
                <li key={receipt.id}>
                  <time dateTime={receipt.requested_at}>
                    {formatWalletEvidenceTime(receipt.requested_at)}
                  </time>
                  <span>
                    {labelWalletReceiptType(receipt.transaction_type)}
                    <small>
                      {walletReceiptStatusLabels[receipt.status] ??
                        "상태 확인 중"}
                    </small>
                  </span>
                  <strong>
                    {historyAmount(receipt.amount_atomic, receipt.currency)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.recordState}>
              접수된 거래 내역이 아직 없어요.
            </p>
          )}
        </section>
        <section
          className={styles.recordCard}
          aria-labelledby="mining-information-title"
        >
          <header>
            <h2 id="mining-information-title">
              <PutdukHomeIcon name="cube" size={24} />
              채굴 상세 정보
            </h2>
            <Link href="/products/allocation">
              배분 보기
              <PutdukIcon name="arrow-right" size={14} />
            </Link>
          </header>
          <dl className={styles.detailFacts} aria-label="채굴 기간">
            <div>
              <dt>기간</dt>
              <dd>{facts.period}</dd>
            </div>
            <div>
              <dt>확정 채굴 합계</dt>
              <dd>{facts.committed}</dd>
            </div>
            <div>
              <dt>정산 전</dt>
              <dd>{facts.pending}</dd>
            </div>
            <div>
              <dt>현재 상태</dt>
              <dd>{presentation.label}</dd>
            </div>
          </dl>
          <p className={styles.detailNote}>
            정산 전 금액은 사용 가능 잔액과 달라요.
          </p>
        </section>
      </div>
      {runtime ? <FundedRuntimeSummary runtime={runtime} /> : null}

      <Link className={styles.guideBanner} href="/how-it-works">
        <span className={styles.guideHeading}>
          <PutdukIcon name="shield" size={25} />
          <strong>채굴과 지갑 안내</strong>
          <PutdukIcon name="arrow-right" size={20} />
        </span>
        <small>확정 금액과 확인 전 금액의 차이를 알아보세요.</small>
      </Link>

      <details className={styles.details} id="putduk-mining-details">
        <summary className={styles.summary}>채굴 상세</summary>
        <div className={styles.detailContent}>
          {legacySessions.length ? (
            <section aria-label="현재 채굴 세션">
              <header className={styles.sectionHeader}>
                <h2>현재 채굴 상태</h2>
                <p>세션에 기록된 상태예요.</p>
              </header>
              <div className={styles.sessionList}>
                {legacySessions.map((session) => {
                  const status = presentMiningStatus(session.status);
                  return (
                    <article
                      className={styles.sessionCard}
                      key={session.mining_session_id}
                    >
                      <header>
                        <h3>{session.world_name_ko}</h3>
                        <ProductStatusPill
                          label={status.label}
                          tone={status.tone}
                        />
                      </header>
                      <dl className={styles.detailFacts}>
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
              </div>
            </section>
          ) : null}
          <header className={styles.sectionHeader}>
            <h2>월드 목록</h2>
            <p>월드는 채굴 테마예요. 시세나 투자 수익을 따르지 않습니다.</p>
          </header>
          {worldsError ? (
            <StatePanel
              tone="error"
              title="월드 목록을 불러오지 못했어요"
              description="잠시 후 다시 확인해 주세요."
              action={<RouteReloadButton label="월드 목록 다시 확인" />}
            />
          ) : worlds?.length ? (
            <section className={styles.worldGrid} aria-label="채굴 월드 목록">
              {worlds.map((world) => (
                <article
                  className={styles.worldCard}
                  key={world.code}
                  style={
                    {
                      "--world-accent": "var(--brand-primary)",
                    } as CSSProperties
                  }
                >
                  <PutdukIcon name="products" size={28} />
                  <div>
                    <h3>{world.display_name_ko}</h3>
                    <p>
                      {legacySessions.some(
                        (session) =>
                          session.world_code === world.code &&
                          isConfirmedMiningRunning(session.status),
                      )
                        ? "현재 활성 세션이 이어지고 있어요."
                        : (worldDescriptions[world.code] ??
                          "퍼뜩의 채굴 테마 월드")}
                    </p>
                  </div>
                </article>
              ))}
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
