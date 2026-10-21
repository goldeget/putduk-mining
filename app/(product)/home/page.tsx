import Link from "next/link";

import { ProductHeader } from "@/components/layout/product-header";
import { SemiconductorTowerScene } from "@/components/brand/semiconductor-tower-scene";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { RouteReloadButton } from "@/components/product/route-reload-button";
import { StatePanel } from "@/components/ui/states";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";
import {
  presentHomeFundingFacts,
  presentHomeMiningFacts,
  resolveHomeWorldState,
} from "@/lib/product/home-world-state";
import { parseMiningServerDisplay } from "@/lib/product/mining-server-display";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";

import styles from "./home.module.css";

/**
 * SIMPLIFIED_TRACK first viewport:
 * brand + one Korean line + one mining CTA (or 채굴 중) + one balance.
 * Products / events / AI are not peer CTAs here.
 */
export default async function ProductHomePage() {
  const identity = await requirePageUser("/home");
  const [
    { data: trial, error: trialError },
    { data: accounts, error: walletError },
    { data: sessions, error: miningError },
    facts,
    fundedResponse,
  ] = await Promise.all([
    identity.supabase
      .from("trial_account_snapshots")
      .select(
        "status, world_name_ko, reward_atomic, quota_consumed_bps, remaining_seconds",
      )
      .eq("user_id", identity.userId)
      .maybeSingle(),
    identity.supabase
      .from("wallet_balance_snapshots")
      .select("currency, balance_atomic, available_balance_atomic")
      .eq("user_id", identity.userId)
      .order("currency"),
    identity.supabase
      .from("mining_active_session_snapshots")
      .select("mining_session_id, world_name_ko, status, unsettled_seconds")
      .eq("user_id", identity.userId)
      .limit(1),
    readMemberScreenFacts(identity),
    readOwnMiningServerDisplay(identity),
  ]);

  const fundedDisplay = fundedResponse.error
    ? null
    : parseMiningServerDisplay(fundedResponse.data);
  const fundedUnavailable = Boolean(fundedResponse.error) || !fundedDisplay;
  const fundedRuntime =
    !fundedUnavailable && fundedDisplay?.available
      ? fundedDisplay.funded_runtime
      : null;
  const miningFacts = presentHomeMiningFacts(fundedRuntime, fundedUnavailable);
  const fundingFacts = presentHomeFundingFacts(
    fundedDisplay,
    fundedUnavailable,
  );
  const krw = walletError
    ? undefined
    : accounts?.find((account) => account.currency === "KRW");
  const walletAmount = walletError
    ? "확인할 수 없어요"
    : formatAtomicAmount(
        String(krw?.available_balance_atomic ?? "0"),
        "KRW",
      ).replace(/ KRW$/, "원");
  const world = resolveHomeWorldState({
    trial,
    mining: sessions?.[0],
    trialUnavailable: Boolean(trialError),
    miningUnavailable: Boolean(miningError),
    fundedDisplay,
    fundedUnavailable,
  });
  const partialFailure = Boolean(
    trialError || walletError || miningError || fundedUnavailable,
  );
  const primaryHref = world.needsRequery ? "/home" : world.primary.href;
  const primaryLabel = world.running
    ? "채굴 중"
    : world.needsRequery
      ? "상태 다시 확인"
      : world.primary.label;

  return (
    <div
      className={styles.page}
      data-ui-ready="/home"
      data-ui-state={partialFailure ? "partial" : world.sourceState}
      data-launch-surface="simplified-track"
    >
      <section className={styles.hero} aria-label="오늘의 채굴">
        <SemiconductorTowerScene
          className={styles.livingVisual}
          sizes="100vw"
          priority
        />
        <ProductHeader home displayName={facts.displayName} />
        <div className={styles.livingWorld}>
          <div className={`${styles.livingOverlay} ${styles.simplifiedHero}`}>
            <p className={styles.brandMark}>퍼뜩</p>
            <h1 className={styles.welcomeTitle}>
              채굴 버튼만 누르면
              <br />
              수익이 쌓여요.
            </h1>
            <p className={styles.welcomeLead}>{world.worldLead}</p>
            <p
              className={styles.heroBalance}
              data-home-amount="wallet"
              aria-label="사용 가능 원화"
            >
              <span className={styles.heroBalanceLabel}>사용 가능</span>
              <strong
                data-home-long-amount={walletAmount.length > 14 || undefined}
              >
                {walletAmount}
              </strong>
            </p>
            {world.needsRequery ? (
              <RouteReloadButton
                className={`button button--primary ${styles.heroPrimary}`}
              />
            ) : (
              <Link
                className={`button button--primary ${styles.heroPrimary}`}
                href={primaryHref}
                data-home-primary-cta
              >
                {primaryLabel}
                <PutdukIcon name="arrow-right" size={18} />
              </Link>
            )}
            {world.running ? (
              <p className={styles.heroStatus} data-running="true">
                {world.liveLabel}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className={styles.dashboard}>
        {partialFailure ? (
          <StatePanel
            tone="error"
            title="일부 정보를 불러오지 못했어요"
            description="확인된 정보만 표시했어요. 잠시 후 다시 시도해 주세요."
            action={<RouteReloadButton className="button button--secondary" />}
          />
        ) : null}

        <section
          className={styles.simplifiedSecondary}
          aria-label="이어서 확인"
        >
          <Link className={styles.simplifiedSecondaryLink} href="/mining">
            <span>
              <strong>채굴 상세</strong>
              <small>
                {fundingFacts.remainingCapacity === "확인할 수 없어요"
                  ? "상태 다시 확인"
                  : fundingFacts.remainingCapacity === "아직 없어요"
                    ? world.liveLabel
                    : `남은 한도 ${fundingFacts.remainingCapacity}`}
              </small>
            </span>
            <PutdukIcon name="arrow-right" size={16} />
          </Link>
          <Link className={styles.simplifiedSecondaryLink} href="/wallet">
            <span>
              <strong>지갑</strong>
              <small>
                {miningFacts.committedTotal === "확인할 수 없어요"
                  ? "잔액 다시 확인"
                  : miningFacts.committedTotal === "아직 없어요"
                    ? "확정 누계 아직 없어요"
                    : `확정 누계 ${miningFacts.committedTotal}`}
              </small>
            </span>
            <PutdukIcon name="arrow-right" size={16} />
          </Link>
          <Link
            className={styles.simplifiedSecondaryLink}
            href="/wallet/deposit"
          >
            <span>
              <strong>입금</strong>
              <small>필요할 때만 입금해요</small>
            </span>
            <PutdukIcon name="arrow-right" size={16} />
          </Link>
        </section>
      </div>
    </div>
  );
}
