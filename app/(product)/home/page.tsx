import Link from "next/link";
import type { Route } from "next";

import { MiningCore } from "@/components/foundation/mining-core";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { Surface } from "@/components/ui/surface";
import { formatTrialValue } from "@/domain/trial/format-trial-value";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";
import { safeProtectedReturnPath } from "@/lib/auth/return-path";

const trialStatusLabel: Record<string, string> = {
  READY: "준비됨",
  ACTIVE: "진행 중",
  COMPLETED: "완료",
  EXPIRED: "종료",
};

export default async function ProductHomePage() {
  const identity = await requirePageUser("/home");
  const [
    { data: trial, error: trialError },
    { data: accounts, error: walletError },
    { data: sessions, error: miningError },
    { data: notifications, error: notificationError },
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
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const krw = accounts?.find((account) => account.currency === "KRW");
  const mining = sessions?.[0];
  const trialPercent = Math.min(
    100,
    Math.max(0, Number(trial?.quota_consumed_bps ?? 0) / 100),
  );
  const primaryHref =
    trial?.status === "ACTIVE" ? "/start" : mining ? "/mining" : "/start";
  const primaryLabel =
    trialError || miningError
      ? "상태 다시 확인"
      : trial?.status === "ACTIVE"
        ? "START 계속하기"
        : mining
          ? "채굴 월드 보기"
          : "첫 채굴 시작";
  const worldStateUnavailable = Boolean(trialError && miningError);
  const trialLabel = trialError
    ? "확인 필요"
    : trialStatusLabel[trial?.status ?? "READY"] ?? "준비됨";

  return (
    <div className="product-home">
      <header className="product-home__welcome">
        <div>
          <p className="eyebrow">TODAY IN PUTDUK</p>
          <h1>오늘도 채굴이 이어지고 있어요.</h1>
          <p>지금 상태와 다음에 할 일만 모았어요.</p>
        </div>
        <Link className="button button--primary" href={primaryHref}>
          {primaryLabel}
          <PutdukIcon name="arrow-right" size={18} />
        </Link>
      </header>

      <section className="product-home__hero" aria-label="오늘의 채굴 상태">
        <Surface as="article" className="living-world" tone="raised">
          <div className="living-world__visual">
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
              />
            </picture>
            <MiningCore />
          </div>
          <div className="living-world__status">
            <span
              className={`live-status${worldStateUnavailable ? " is-unavailable" : ""}`}
            >
              <i />
              {worldStateUnavailable
                ? "상태를 불러오지 못했어요"
                : mining
                  ? "채굴 진행 중"
                  : trial?.status === "ACTIVE"
                    ? "PUTDUK START 진행 중"
                    : "시작 준비 완료"}
            </span>
            <h2>
              {worldStateUnavailable
                ? "다시 확인해 주세요"
                : (mining?.world_name_ko ?? trial?.world_name_ko ?? "KOREA")}
            </h2>
            <p>
              {worldStateUnavailable
                ? "연결을 확인한 뒤 다시 열어 주세요."
                : mining
                  ? `다음 확인 전 ${Number(mining.unsettled_seconds).toLocaleString("ko-KR")}초`
                  : "안내에 따라 첫 채굴 결과를 만나보세요."}
            </p>
          </div>
        </Surface>

        <div className="product-home__summary">
          <Surface as="article" className="home-balance-card">
            <span>
              <PutdukIcon name="wallet" size={18} />
              사용 가능 KRW
            </span>
            <strong>
              {walletError
                ? "확인할 수 없음"
                : formatAtomicAmount(
                    String(krw?.available_balance_atomic ?? "0"),
                    "KRW",
                  )}
            </strong>
            <p>
              {walletError
                ? "지갑을 잠시 후 다시 확인해 주세요."
                : "체험 값은 포함되지 않습니다."}
            </p>
            <Link href="/wallet">
              지갑 보기 <PutdukIcon name="arrow-right" size={16} />
            </Link>
          </Surface>
          <Surface as="article" className="home-start-card">
            <span>PUTDUK START</span>
            <strong>{trialLabel}</strong>
            <div
              className="product-progress"
              aria-label={
                trialError
                  ? "체험 진행률을 불러오지 못함"
                  : `체험 진행률 ${trialPercent.toFixed(0)}%`
              }
            >
              <span style={{ width: trialError ? "0%" : `${trialPercent}%` }} />
            </div>
            <p>
              {trialError
                ? "체험 상태를 불러오지 못했어요."
                : `체험 결과 ${formatTrialValue(String(trial?.reward_atomic ?? "0"))}`}
            </p>
          </Surface>
        </div>
      </section>

      <section className="product-home__lower">
        <div className="home-notifications">
          <header>
            <div>
              <p className="eyebrow">RECENT UPDATES</p>
              <h2>최근 알림</h2>
            </div>
            <Link href="/notifications">전체 보기</Link>
          </header>
          {notificationError ? (
            <div className="home-notifications__empty is-error">
              <PutdukIcon name="bell" size={24} />
              <p>알림을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p>
            </div>
          ) : notifications?.length ? (
            notifications.map((notification) => (
              <Link
                href={
                  safeProtectedReturnPath(
                    notification.route,
                    "/notifications",
                  ) as Route
                }
                key={notification.id}
              >
                <span
                  className={notification.read_at ? undefined : "is-unread"}
                  aria-hidden="true"
                />
                <span>
                  <small>{notification.category}</small>
                  <strong>{notification.title_ko}</strong>
                  <p>{notification.body_ko}</p>
                </span>
                <time dateTime={notification.created_at}>
                  {new Intl.DateTimeFormat("ko-KR", {
                    month: "short",
                    day: "numeric",
                    timeZone: "Asia/Seoul",
                  }).format(new Date(notification.created_at))}
                </time>
              </Link>
            ))
          ) : (
            <div className="home-notifications__empty">
              <PutdukIcon name="bell" size={24} />
              <p>새 알림이 없어요. 중요한 변화가 생기면 알려드릴게요.</p>
            </div>
          )}
        </div>
        <Surface as="aside" className="home-ai-card" tone="raised">
          <PutdukIcon name="ai" size={26} />
          <p className="eyebrow">PUTDUK AI</p>
          <h2>채굴과 지갑, 궁금한 점을 물어보세요.</h2>
          <p>확인할 수 없는 금액은 추측하지 않습니다.</p>
          <Link className="button button--secondary" href="/ai">
            PUTDUK AI 열기
          </Link>
        </Surface>
      </section>
    </div>
  );
}
