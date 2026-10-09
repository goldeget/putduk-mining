import Link from "next/link";
import type { Route } from "next";
import { ProductHeader } from "@/components/layout/product-header";
import { GoldCategoryArtwork } from "@/components/brand/gold-category-artwork";
import { CatalogMaterialArtwork } from "@/components/brand/catalog-material-artwork";

import { SemiconductorTowerScene } from "@/components/brand/semiconductor-tower-scene";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PutdukHomeIcon } from "@/components/icons/putduk-home-icon";
import { FundedRuntimeSummary } from "@/components/product/funded-runtime-summary";
import { PutdukAiDock } from "@/components/product/putduk-ai-dock";
import { RouteReloadButton } from "@/components/product/route-reload-button";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import {
  filterMemberVisibleEvents,
  MEMBER_VISIBLE_EVENT_STATUSES,
  selectFeaturedEvent,
  type MemberEventRow,
} from "@/domain/events/member-read-model";
import { activeMemberNotificationExpiryOr } from "@/domain/notifications/member-inbox";
import type { ProductCategory } from "@/domain/products/published-catalog";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";
import { safeProtectedReturnPath } from "@/lib/auth/return-path";
import {
  formatTrialQuotaPercent,
  presentTrialStatus,
} from "@/lib/product/home-start-display";
import {
  presentHomeFundingFacts,
  presentHomeMiningFacts,
  resolveHomeWorldState,
} from "@/lib/product/home-world-state";
import { parseMiningServerDisplay } from "@/lib/product/mining-server-display";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";
import { formatJoinedOn } from "@/lib/product/member-screen-present";
import { getPublishedCatalog } from "@/lib/product/published-catalog";
import { presentHomeCapacityProgress } from "@/lib/product/home-capacity-progress";

import styles from "./home.module.css";

const categoryLabels: Record<ProductCategory, string> = {
  KR_STOCK: "한국 주식 테마",
  US_STOCK: "미국 주식 테마",
  GOLD: "금",
  SILVER: "은",
  CRYPTO: "디지털 자산 테마",
};

const availabilityLabels = {
  available: "제공 중",
  scheduled: "제공 예정",
  paused: "제공 중단",
  retired: "제공 종료",
  unavailable: "상태 확인",
} as const;

export default async function ProductHomePage() {
  const identity = await requirePageUser("/home");
  // 알림 만료 경계는 이 서버 시각이다. 클라이언트 시계를 쓰지 않는다.
  const notificationNow = new Date();
  const [
    { data: trial, error: trialError },
    { data: accounts, error: walletError },
    { data: sessions, error: miningError },
    { data: notifications, error: notificationError },
    facts,
    catalog,
    { data: eventsData, error: eventsError },
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
    identity.supabase
      .from("notifications")
      .select("id, category, title_ko, body_ko, route, read_at, created_at")
      .eq("user_id", identity.userId)
      .lte("scheduled_at", notificationNow.toISOString())
      .or(activeMemberNotificationExpiryOr(notificationNow))
      .order("created_at", { ascending: false })
      .limit(3),
    readMemberScreenFacts(identity),
    getPublishedCatalog(),
    identity.supabase
      .from("events")
      .select(
        "id, slug, title_ko, summary_ko, status, starts_at, ends_at, published_at",
      )
      .in("status", [...MEMBER_VISIBLE_EVENT_STATUSES])
      .not("published_at", "is", null)
      .lte("published_at", notificationNow.toISOString())
      .order("starts_at", { ascending: false })
      .limit(8),
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
  const miningFacts = presentHomeMiningFacts(fundedRuntime);
  const fundingFacts = presentHomeFundingFacts(
    fundedDisplay,
    fundedUnavailable,
  );
  const capacityProgress = presentHomeCapacityProgress(
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
  const committedAmount = miningFacts.committedTotal.replace(/ KRW$/, "원");
  const world = resolveHomeWorldState({
    trial,
    mining: sessions?.[0],
    trialUnavailable: Boolean(trialError),
    miningUnavailable: Boolean(miningError),
    fundedDisplay,
    fundedUnavailable,
  });
  const trialPercent = world.trialStatusKnown
    ? formatTrialQuotaPercent(trial?.quota_consumed_bps)
    : null;
  const trialPresentation = presentTrialStatus(
    trialError
      ? "UNAVAILABLE"
      : world.trialStatusKnown
        ? (trial?.status ?? "READY")
        : undefined,
  );
  const startActionLabel = !world.trialStatusKnown
    ? "START 상태 확인"
    : trial?.status === "ACTIVE"
      ? "START 계속하기"
      : !trial || trial.status === "READY"
        ? "첫 채굴 시작"
        : "START 결과 보기";
  const partialFailure = Boolean(
    trialError ||
    walletError ||
    miningError ||
    notificationError ||
    fundedUnavailable,
  );
  const featuredEvent = eventsError
    ? undefined
    : selectFeaturedEvent(
        filterMemberVisibleEvents(
          (eventsData ?? []) as MemberEventRow[],
          notificationNow.toISOString(),
        ),
      );
  const catalogProducts =
    catalog.state === "loaded"
      ? catalog.products.filter((product) => product.isFeatured)
      : [];
  const shownProducts = (
    catalogProducts.length > 0
      ? catalogProducts
      : catalog.state === "loaded"
        ? catalog.products
        : []
  )
    .slice()
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .slice(0, 3);

  return (
    <div
      className={styles.page}
      data-ui-ready="/home"
      data-ui-state={partialFailure ? "partial" : world.sourceState}
    >
      <section className={styles.hero} aria-label="오늘의 채굴 상태">
        <SemiconductorTowerScene
          className={styles.livingVisual}
          sizes="100vw"
          priority
        />
        <ProductHeader home displayName={facts.displayName} />
        <div className={styles.livingWorld}>
          <div className={styles.livingOverlay}>
            <h1 className={styles.welcomeTitle}>
              <span className={styles.darkGreeting}>
                안녕하세요,
                <br />
                {facts.displayName}님
              </span>
              <span className={styles.lightGreeting}>
                더 큰 가치를 만드는
                <br />
                여정이 계속됩니다.
              </span>
            </h1>
            <p className={styles.welcomeLead}>
              <span className={styles.darkGreeting}>
                작은 한 걸음이
                <br />더 큰 가치를 만듭니다.
              </span>
              <span className={styles.lightGreeting}>
                AI와 반도체가 만드는
                <br />더 나은 내일, PUTDUK MINING
              </span>
            </p>
          </div>
          <Link className={styles.desktopRank} href="/menu">
            <PutdukHomeIcon name="crown" size={38} />
            <strong>{facts.rankName ?? "등급 확인"}</strong>
            <span>내 등급 살펴보기</span>
          </Link>
        </div>
      </section>

      <div className={styles.dashboard}>
        <Surface
          as="section"
          className={styles.summary}
          aria-label="내 채굴 정보"
        >
          <Link className={styles.lightIdentity} href="/menu">
            <span className={styles.memberPortrait} aria-hidden="true">
              <PutdukIcon name="user" size={32} />
            </span>
            <div>
              <strong>{facts.displayName}님</strong>
              <span>{facts.rankName ?? "등급 확인이 필요해요"}</span>
              <p>내 채굴 정보를 함께 살펴보세요.</p>
            </div>
            <PutdukIcon name="arrow-right" size={18} />
          </Link>
          <div className={styles.summaryGrid}>
            <article className={styles.summaryCard}>
              <span className={styles.summaryIcon} aria-hidden="true">
                <PutdukHomeIcon name="chart" size={28} />
              </span>
              <div>
                <h2 className={styles.summaryLabel}>오늘 채굴</h2>
                <strong className={styles.summaryValue}>
                  {miningFacts.today}
                </strong>
              </div>
            </article>
            <Link className={styles.summaryCard} href="/menu" data-fact="rank">
              <span className={styles.summaryIcon} aria-hidden="true">
                <PutdukHomeIcon name="crown" size={28} />
              </span>
              <div>
                <h2 className={styles.summaryLabel}>현재 등급</h2>
                <strong className={styles.summaryValue}>
                  {facts.rankName ?? "확인할 수 없어요"}
                </strong>
              </div>
              <PutdukIcon
                className={styles.factArrow}
                name="arrow-right"
                size={14}
              />
            </Link>
            <Link
              className={styles.summaryCard}
              href="/mining"
              data-fact="principal"
            >
              <span className={styles.summaryIcon} aria-hidden="true">
                <PutdukHomeIcon name="coins" size={28} />
              </span>
              <div>
                <h2 className={styles.summaryLabel}>인정 원금</h2>
                <strong className={styles.summaryValue}>
                  {fundingFacts.principal}
                </strong>
              </div>
              <PutdukIcon
                className={styles.factArrow}
                name="arrow-right"
                size={14}
              />
            </Link>
            <Link
              className={styles.summaryCard}
              href="/mining"
              data-fact="capacity"
            >
              <span className={styles.summaryIcon} aria-hidden="true">
                <PutdukHomeIcon name="capacity" size={28} />
              </span>
              <div>
                <h2 className={styles.summaryLabel}>남은 채굴 한도</h2>
                <strong className={styles.summaryValue}>
                  {fundingFacts.remainingCapacity}
                </strong>
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
              </div>
              <PutdukIcon
                className={styles.factArrow}
                name="arrow-right"
                size={14}
              />
            </Link>
            <article
              className={`${styles.summaryCard} ${styles.lightCommitted}`}
            >
              <div>
                <h2 className={styles.summaryLabel}>현재 채굴 확정 누계</h2>
                <strong className={styles.summaryValue}>
                  {miningFacts.committedTotal}
                </strong>
              </div>
            </article>
          </div>
        </Surface>

        <section className={styles.lightStatus} aria-label="채굴 진행 상태">
          <div>
            <PutdukIcon name="mining" size={28} />
            <div>
              <h2>채굴 진행 상태</h2>
              <p>{world.liveLabel}</p>
            </div>
          </div>
          <p>
            남은 채굴 한도 <strong>{fundingFacts.remainingCapacity}</strong>
          </p>
          {world.needsRequery ? (
            <RouteReloadButton className="button button--secondary" />
          ) : (
            <Link href={world.primary.href}>
              {world.primary.label}
              <PutdukIcon name="arrow-right" size={16} />
            </Link>
          )}
        </section>

        <nav className={styles.quickActions} aria-label="바로 가기">
          <div className={styles.quickActionsLayout}>
            <div className={styles.quickActionGrid} data-home-primary-actions>
              <Link href="/mining">
                <PutdukHomeIcon name="bolt" size={28} />
                <strong>채굴 보기</strong>
                <small>내 채굴 상태</small>
              </Link>
              <Link href="/wallet/deposit">
                <PutdukHomeIcon name="bank" size={28} />
                <strong>
                  <span className={styles.darkActionLabel}>입금하기</span>
                  <span className={styles.lightActionLabel}>자산 추가하기</span>
                </strong>
                <small>입금 안내</small>
              </Link>
              <Link href="/wallet/withdraw">
                <PutdukHomeIcon name="wallet" size={28} />
                <strong>출금하기</strong>
                <small>출금 신청</small>
              </Link>
              <Link href="/events" className={styles.darkQuickAction}>
                <PutdukHomeIcon name="gift" size={28} />
                <strong>이벤트</strong>
                <small>소식 보기</small>
              </Link>
              <Link
                href="/wallet?view=history"
                className={styles.lightQuickAction}
              >
                <PutdukHomeIcon name="ledger" size={28} />
                <strong>거래 내역</strong>
              </Link>
            </div>
            <PutdukAiDock presentation="inline" />
          </div>
        </nav>

        <section className={styles.catalogAndNotices}>
          <section className={styles.products} aria-label="추천 상품">
            <header className={styles.sectionHeader}>
              <h2>추천 상품</h2>
              <Link href="/products">
                상품 보기 <PutdukIcon name="arrow-right" size={14} />
              </Link>
            </header>
            {catalog.state === "error" ? (
              <p className={styles.sectionEmpty}>
                상품을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
              </p>
            ) : shownProducts.length ? (
              <ul
                className={styles.productList}
                data-product-count={shownProducts.length}
              >
                {shownProducts.map((product) => (
                  <li key={product.id}>
                    <Link
                      className={styles.productCard}
                      href="/products"
                      data-category={product.category}
                    >
                      <ProductArtwork category={product.category} />
                      <strong>{product.nameKo}</strong>
                      <small>{categoryLabels[product.category]}</small>
                      <span className={styles.productAvailability}>
                        {availabilityLabels[product.availability.state]}
                      </span>
                      <PutdukIcon
                        className={styles.productArrow}
                        name="arrow-right"
                        size={16}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.sectionEmpty}>공개된 상품이 아직 없어요.</p>
            )}
          </section>

          <section className={styles.notifications} aria-label="최근 알림">
            <header className={styles.notificationsHeader}>
              <h2>
                <PutdukIcon name="bell" size={18} /> 최근 알림
              </h2>
              <Link href="/notifications">전체 보기</Link>
            </header>
            {notificationError ? (
              <p className={styles.notificationsEmpty}>
                알림을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
              </p>
            ) : notifications?.length ? (
              notifications.map((notification) => (
                <Link
                  className={styles.notificationRow}
                  href={
                    safeProtectedReturnPath(
                      notification.route,
                      "/notifications",
                    ) as Route
                  }
                  key={notification.id}
                >
                  <span
                    className={`${styles.notificationDot}${notification.read_at ? "" : ` ${styles.notificationDotUnread}`}`}
                    aria-hidden="true"
                  />
                  <strong>{notification.title_ko}</strong>
                  <time dateTime={notification.created_at}>
                    {new Intl.DateTimeFormat("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(notification.created_at))}
                  </time>
                  <PutdukIcon name="arrow-right" size={14} />
                </Link>
              ))
            ) : (
              <p className={styles.notificationsEmpty}>새 알림이 없어요.</p>
            )}
          </section>
        </section>

        <section className={styles.eventBand} aria-label="이벤트">
          <Link
            className={styles.eventCard}
            href={
              featuredEvent
                ? (`/events/${featuredEvent.slug}` as Route)
                : "/events"
            }
          >
            <span className={styles.eventVisual} aria-hidden="true">
              <picture className={styles.eventArtwork}>
                {(["avif", "webp"] as const).map((format) => (
                  <source
                    key={format}
                    type={`image/${format}`}
                    srcSet={[480, 960, 1280, 1920]
                      .map(
                        (width) =>
                          `/brand/scenes/home-event-gift/home-event-gift-${width}-v1.${format} ${width}w`,
                      )
                      .join(", ")}
                    sizes="(min-width: 980px) 48vw, 48vw"
                  />
                ))}
                <img
                  src="/brand/scenes/home-event-gift/home-event-gift-480-v1.webp"
                  width={1983}
                  height={793}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </picture>
              <picture
                className={`${styles.eventArtwork} ${styles.lightEventArtwork}`}
                data-art-theme="light"
              >
                {(["avif", "webp"] as const).map((format) => (
                  <source
                    key={format}
                    type={`image/${format}`}
                    srcSet={[960, 1280, 1536, 1920]
                      .map(
                        (width) =>
                          `/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-${width}-v1.${format} ${width}w`,
                      )
                      .join(", ")}
                    sizes="48vw"
                  />
                ))}
                <img
                  src="/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-960-v1.webp"
                  width={1983}
                  height={793}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                />
              </picture>
            </span>
            <div className={styles.eventCopy}>
              <p className={styles.eventEyebrow}>이벤트</p>
              <h2>
                {eventsError
                  ? "이벤트를 다시 확인해 주세요"
                  : featuredEvent
                    ? featuredEvent.title_ko
                    : "새로운 소식을 기다려 주세요"}
              </h2>
              <p>
                {eventsError
                  ? "잠시 후 다시 확인해 주세요."
                  : featuredEvent
                    ? featuredEvent.summary_ko
                    : "진행 중인 이벤트가 아직 없어요."}
              </p>
            </div>
            <span className={styles.eventArrow}>
              <PutdukIcon name="arrow-right" size={18} />
            </span>
          </Link>
        </section>

        <section className={styles.featureBand} aria-label="확인된 채굴 상태">
          <div className={styles.confirmedStatus}>
            <span className={styles.liveStatus} data-running={world.running}>
              <i aria-hidden="true" />
              {world.liveLabel}
            </span>
            <p>{world.worldLead}</p>
          </div>
          {world.needsRequery ? (
            <RouteReloadButton
              className={`button button--secondary ${styles.stateAction}`}
            />
          ) : (
            <Link className={styles.stateAction} href={world.primary.href}>
              {world.primary.label}
              <PutdukIcon name="arrow-right" size={16} />
            </Link>
          )}
        </section>

        {partialFailure ? (
          <StatePanel
            tone="error"
            title="일부 정보를 불러오지 못했어요"
            description="확인된 정보만 표시했어요. 잠시 후 다시 시도해 주세요."
            action={<RouteReloadButton className="button button--secondary" />}
          />
        ) : null}

        <Surface
          as="section"
          className={styles.profile}
          aria-label="지갑과 체험 정보"
        >
          <dl className={styles.profileStats}>
            <div>
              <dt>사용 가능 원화</dt>
              <dd>
                <span
                  className={styles.profileAmount}
                  data-home-amount="wallet"
                  data-home-long-amount={walletAmount.length > 14 || undefined}
                >
                  {walletAmount}
                </span>
                <p>체험 값은 포함되지 않습니다.</p>
                <Link href="/wallet">
                  지갑 보기 <PutdukIcon name="arrow-right" size={14} />
                </Link>
              </dd>
            </div>
            <div>
              <dt>현재 채굴 확정 누계</dt>
              <dd>
                <span
                  className={styles.profileAmount}
                  data-home-amount="committed"
                  data-home-long-amount={
                    committedAmount.length > 14 || undefined
                  }
                >
                  {committedAmount}
                </span>
                <p>현재 채굴에서 확정된 기록이에요.</p>
              </dd>
            </div>
            <div role="group" aria-label="PUTDUK START 체험">
              <dt>PUTDUK START</dt>
              <dd>
                {trialPresentation.label}
                <p>
                  {!world.trialStatusKnown
                    ? "체험 상태를 다시 확인해 주세요."
                    : !trial
                      ? "아직 시작 전이에요."
                      : trial.reward_atomic === null ||
                          trial.reward_atomic === undefined ||
                          String(trial.reward_atomic).trim() === ""
                        ? "체험 결과를 다시 확인해 주세요."
                        : `체험 결과 ${formatTrialValue(String(trial.reward_atomic))}`}
                </p>
                {trialPercent !== null && !trialError ? (
                  <div
                    className={styles.progress}
                    aria-label={`체험 진행률 ${trialPercent.toFixed(0)}%`}
                  >
                    <span style={{ width: `${trialPercent}%` }} />
                  </div>
                ) : null}
                <Link href="/start">
                  {startActionLabel} <PutdukIcon name="arrow-right" size={14} />
                </Link>
              </dd>
            </div>
          </dl>
          <p className={styles.profileJoined}>
            가입일 {formatJoinedOn(facts.joinedAt)}
          </p>
        </Surface>

        {fundedRuntime ? (
          <FundedRuntimeSummary runtime={fundedRuntime} placement="home" />
        ) : null}
      </div>
    </div>
  );
}

/** Unbranded category decoration, never an illustration of a specific holding. */
function ProductArtwork({ category }: { category: ProductCategory }) {
  if (category === "GOLD") {
    return (
      <span
        className={`${styles.productArtwork} ${styles.productArtworkPhoto}`}
        aria-hidden="true"
      >
        <GoldCategoryArtwork />
      </span>
    );
  }
  return (
    <span className={styles.productArtworkNative} aria-hidden="true">
      <CatalogMaterialArtwork
        category={category}
        sizes="(min-width: 980px) 30vw, (min-width: 600px) 33vw, 100vw"
      />
    </span>
  );
}
