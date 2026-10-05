import Link from "next/link";
import type { Route } from "next";

import { MiningCore } from "@/components/foundation/mining-core";
import { PutdukIcon } from "@/components/icons/putduk-icon";
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
import { resolveHomeWorldState } from "@/lib/product/home-world-state";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";
import {
  formatJoinedOn,
  formatScreenKrw,
} from "@/lib/product/member-screen-present";
import { getPublishedCatalog } from "@/lib/product/published-catalog";

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
  ]);

  const krw = walletError
    ? undefined
    : accounts?.find((account) => account.currency === "KRW");
  const world = resolveHomeWorldState({
    trial,
    mining: sessions?.[0],
    trialUnavailable: Boolean(trialError),
    miningUnavailable: Boolean(miningError),
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
  const partialFailure = Boolean(
    trialError || walletError || miningError || notificationError,
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
      {partialFailure ? (
        <StatePanel
          tone="error"
          title="일부 정보를 불러오지 못했어요"
          description="보이는 값은 서버에서 확인된 내용만 보여 드려요. 잠시 후 다시 확인해 주세요."
          action={<RouteReloadButton className="button button--secondary" />}
        />
      ) : null}

      <section className={styles.hero} aria-label="오늘의 채굴 상태">
        <Surface as="article" className={styles.livingWorld} tone="raised">
          <div className={styles.livingVisual}>
            <picture>
              <source
                type="image/avif"
                srcSet="/brand/worlds/orbital-earth-960-v1.avif"
              />
              <img
                src="/brand/worlds/orbital-earth-960-v1.webp"
                alt="우주에서 바라본 퍼뜩 채굴 월드"
                width="960"
                height="540"
                decoding="async"
                fetchPriority="high"
              />
            </picture>
            <MiningCore running={world.running} />
          </div>
          <div className={styles.livingOverlay}>
            <header className={styles.welcome}>
              <div className={styles.welcomeCopy}>
                <p className="eyebrow">오늘</p>
                <h1 className={styles.welcomeTitle}>
                  {world.running
                    ? "오늘도 채굴이 이어지고 있어요."
                    : "오늘의 채굴 상태를 확인해요."}
                </h1>
                <p className={styles.welcomeLead}>
                  지금 상태와 다음에 할 일만 모았어요.
                </p>
              </div>
              {world.needsRequery ? (
                <RouteReloadButton
                  className={`button button--primary ${styles.primaryAction}`}
                />
              ) : (
                <Link
                  className={`button button--primary ${styles.primaryAction}`}
                  href={world.primary.href}
                >
                  {world.primary.label}
                  <PutdukIcon name="arrow-right" size={18} />
                </Link>
              )}
            </header>
          </div>
        </Surface>

        <div className={styles.summary}>
          <Surface as="article" className={styles.summaryCard}>
            <span className={styles.summaryLabel}>
              <PutdukIcon name="wallet" size={18} />
              사용 가능 KRW
            </span>
            <strong className={styles.summaryValue}>
              {walletError
                ? "확인할 수 없음"
                : formatAtomicAmount(
                    String(krw?.available_balance_atomic ?? "0"),
                    "KRW",
                  )}
            </strong>
            <p className={styles.summaryHint}>
              {walletError
                ? "지갑을 잠시 후 다시 확인해 주세요."
                : "체험 값은 포함되지 않습니다."}
            </p>
            <Link className={styles.summaryLink} href="/wallet">
              지갑 보기 <PutdukIcon name="arrow-right" size={16} />
            </Link>
          </Surface>
          <Surface as="article" className={styles.summaryCard}>
            <span className={styles.summaryLabel}>PUTDUK START</span>
            <strong className={styles.summaryValue}>
              {trialPresentation.label}
            </strong>
            <div
              className={styles.progress}
              aria-label={
                world.trialStatusKnown && !trial
                  ? "체험 시작 전"
                  : trialPercent === null
                    ? "체험 진행률 확인 불가"
                    : `체험 진행률 ${trialPercent.toFixed(0)}%`
              }
            >
              <span
                style={{
                  width:
                    trialError || trialPercent === null
                      ? "0%"
                      : `${trialPercent}%`,
                }}
              />
            </div>
            <p className={styles.summaryHint}>
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
            <Link className={styles.summaryLink} href="/start">
              START 보기 <PutdukIcon name="arrow-right" size={16} />
            </Link>
          </Surface>
        </div>
      </section>

      <Surface as="section" className={styles.profile} aria-label="내 프로필">
        <div className={styles.profileIdentity}>
          <span className={styles.profileMark} aria-hidden="true">
            <PutdukIcon name="user" size={22} />
          </span>
          <div>
            <strong>{facts.displayName}</strong>
            <p>{facts.rankName ?? "등급은 아직 없어요"}</p>
            <p>가입일 {formatJoinedOn(facts.joinedAt)}</p>
          </div>
        </div>
        <dl className={styles.profileStats}>
          <div>
            <dt>사용 가능</dt>
            <dd>
              {formatScreenKrw(
                facts.availableKrwAtomic,
                facts.walletUnavailable,
              )}
            </dd>
          </div>
          <div>
            <dt>오늘 채굴</dt>
            <dd>아직 없어요</dd>
          </div>
          <div>
            <dt>누적 채굴</dt>
            <dd>아직 표시할 수 없어요</dd>
          </div>
        </dl>
      </Surface>

      <nav className={styles.quickActions} aria-label="바로 가기">
        <Link href="/mining">
          <PutdukIcon name="mining" size={20} />
          <span>채굴 보기</span>
        </Link>
        <Link href="/wallet/deposit">
          <PutdukIcon name="wallet" size={20} />
          <span>입금하기</span>
        </Link>
        <Link href="/wallet/withdraw">
          <PutdukIcon name="arrow-right" size={20} />
          <span>출금하기</span>
        </Link>
        <Link href="/mining#putduk-mining-details">
          <PutdukIcon name="pulse" size={20} />
          <span>채굴 내역</span>
        </Link>
      </nav>

      <section className={styles.products} aria-label="추천 상품">
        <header className={styles.sectionHeader}>
          <h2>추천 상품</h2>
          <Link href="/products">전체 보기</Link>
        </header>
        {catalog.state === "error" ? (
          <p className={styles.sectionEmpty}>
            상품을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
          </p>
        ) : shownProducts.length ? (
          <ul className={styles.productList}>
            {shownProducts.map((product) => (
              <li key={product.id}>
                <Link className={styles.productCard} href="/products">
                  <small>{categoryLabels[product.category]}</small>
                  <strong>{product.nameKo}</strong>
                  <span>{availabilityLabels[product.availability.state]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>공개된 상품이 아직 없어요.</p>
        )}
      </section>

      <section className={styles.eventBand} aria-label="이벤트">
        {eventsError ? (
          <p className={styles.sectionEmpty}>
            이벤트를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
          </p>
        ) : featuredEvent ? (
          <Link
            className={styles.eventCard}
            href={`/events/${featuredEvent.slug}` as Route}
          >
            <p className="eyebrow">이벤트</p>
            <h2>{featuredEvent.title_ko}</h2>
            <p>{featuredEvent.summary_ko}</p>
            <span>
              자세히 보기 <PutdukIcon name="arrow-right" size={16} />
            </span>
          </Link>
        ) : (
          <p className={styles.sectionEmpty}>진행 중인 이벤트가 아직 없어요.</p>
        )}
      </section>

      <section className={styles.featureBand}>
        <Surface as="article" className={styles.featureCard}>
          <span
            className={`${styles.liveStatus}${world.needsRequery ? ` ${styles.liveStatusUnavailable}` : ""}`}
          >
            <i className={styles.liveStatusDot} aria-hidden="true" />
            {world.liveLabel}
          </span>
          <h2 className={styles.featureTitle}>{world.worldTitle}</h2>
          <p className={styles.featureLead}>{world.worldLead}</p>
        </Surface>

        <div className={styles.notifications}>
          <header className={styles.notificationsHeader}>
            <div>
              <p className="eyebrow">알림</p>
              <h2>최근 알림</h2>
            </div>
            <Link href="/notifications">전체 보기</Link>
          </header>
          {notificationError ? (
            <div
              className={`${styles.notificationsEmpty} ${styles.notificationsEmptyError}`}
            >
              <PutdukIcon name="bell" size={24} />
              <p>알림을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p>
            </div>
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
                <span>
                  <small className={styles.notificationMeta}>
                    {notification.category}
                  </small>
                  <strong className={styles.notificationTitle}>
                    {notification.title_ko}
                  </strong>
                  <p className={styles.notificationBody}>
                    {notification.body_ko}
                  </p>
                </span>
                <time
                  className={styles.notificationTime}
                  dateTime={notification.created_at}
                >
                  {new Intl.DateTimeFormat("ko-KR", {
                    month: "short",
                    day: "numeric",
                    timeZone: "Asia/Seoul",
                  }).format(new Date(notification.created_at))}
                </time>
              </Link>
            ))
          ) : (
            <div className={styles.notificationsEmpty}>
              <PutdukIcon name="bell" size={24} />
              <p>새 알림이 없어요. 중요한 변화가 생기면 알려드릴게요.</p>
            </div>
          )}
        </div>
      </section>

      <Surface as="aside" className={styles.aiStrip} tone="raised">
        <span className={styles.aiMark}>
          <PutdukIcon name="ai" size={26} />
        </span>
        <span className={styles.aiCopy}>
          <p className="eyebrow">퍼뜩 AI</p>
          <h2>채굴과 지갑, 궁금한 점을 물어보세요.</h2>
          <p>확인할 수 없는 금액은 추측하지 않습니다.</p>
        </span>
        <Link className="button button--secondary" href="/ai">
          퍼뜩 AI 열기
        </Link>
      </Surface>

      {world.notStarted ? (
        <StatePanel
          tone="empty"
          title="아직 시작 전이에요"
          description="PUTDUK START에서 첫 채굴을 시작해 보세요."
          action={
            <Link className="button button--primary" href="/start">
              첫 채굴 시작
              <PutdukIcon name="arrow-right" size={18} />
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
