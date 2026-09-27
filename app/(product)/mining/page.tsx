import type { CSSProperties } from "react";
import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
import { requirePageUser } from "@/lib/auth/session";

const miningStatusCopy: Record<
  string,
  { label: string; tone: ProductStatusTone }
> = {
  NORMAL: { label: "채굴 중", tone: "success" },
  REDUCED: { label: "속도 조정 중", tone: "warning" },
  MAINTENANCE: { label: "점검 중", tone: "warning" },
  PARTIAL_STOP: { label: "일부 기능 중지", tone: "warning" },
  STOPPED: { label: "중지", tone: "danger" },
};

const worldColors: Record<string, string> = {
  CRYPTO: "#a28ce8",
  GOLD: "#d9b873",
  KOREA: "#f6c85b",
  SILVER: "#b9c4ca",
  USA: "#78aee8",
};

const worldDescriptions: Record<string, string> = {
  CRYPTO: "디지털 자산 테마를 담은 가상 채굴 월드",
  GOLD: "금빛 광맥과 깊은 채굴감을 담은 가상 월드",
  KOREA: "퍼뜩의 첫 여정이 시작되는 기본 채굴 월드",
  SILVER: "차분한 금속성과 정밀한 흐름을 담은 가상 월드",
  USA: "넓은 스케일과 역동성을 담은 가상 채굴 월드",
};

function formatDuration(secondsValue: number | string) {
  const seconds = Math.max(0, Number(secondsValue));
  if (!Number.isFinite(seconds)) {
    return "확인 중";
  }
  if (seconds < 60) {
    return "1분 미만";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}분`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

export default async function MiningPage() {
  const identity = await requirePageUser();
  const [
    { data: sessions, error: sessionsError },
    { data: worlds, error: worldsError },
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
  ]);
  const currentSession = sessions?.[0];
  const currentStatus = currentSession
    ? (miningStatusCopy[currentSession.status] ?? {
        label: "상태 확인 중",
        tone: "info" as const,
      })
    : null;

  return (
    <div className={styles.worldPage}>
      <PageHeading
        eyebrow="MINING WORLDS"
        title="당신의 채굴 월드"
        lead="앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요."
      />

      {sessionsError ? (
        <StatePanel
          tone="error"
          title="채굴 상태를 불러오지 못했어요"
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 화면을 닫아도 서버에서 이어지는 세션에는 영향이 없습니다."
        />
      ) : (
        <section
          className={styles.worldHero}
          aria-labelledby="world-hero-title"
        >
          <picture className={styles.worldHeroPicture}>
            <source
              type="image/avif"
              srcSet="/brand/worlds/orbital-earth-960-v1.avif 960w, /brand/worlds/orbital-earth-1600-v1.avif 1600w, /brand/worlds/orbital-earth-2400-v1.avif 2400w"
              sizes="(max-width: 760px) 100vw, 80vw"
            />
            <img
              src="/brand/worlds/orbital-earth-1600-v1.webp"
              alt=""
              width="1600"
              height="900"
              decoding="async"
              fetchPriority="high"
            />
          </picture>
          <div className={styles.worldHeroContent}>
            <div className={styles.worldHeroMeta}>
              {currentStatus ? (
                <ProductStatusPill
                  label={currentStatus.label}
                  tone={currentStatus.tone}
                />
              ) : (
                <ProductStatusPill label="시작 전" tone="neutral" />
              )}
              {currentSession ? (
                <span className="eyebrow">{currentSession.world_code}</span>
              ) : null}
            </div>
            <h2 id="world-hero-title">
              {currentSession
                ? `${currentSession.world_name_ko}에서 여정이 이어지고 있어요`
                : "첫 월드에서 채굴 여정을 시작해 보세요"}
            </h2>
            <p>
              {currentSession
                ? "화면의 숫자를 임의로 늘리지 않습니다. 정산 전 경과 시간과 세션 상태는 서버에서 확인된 값으로만 표시됩니다."
                : "PUTDUK START로 첫 채굴 흐름을 경험한 뒤, 이용 가능한 실제 채굴 상품을 확인할 수 있어요."}
            </p>
            {currentSession ? (
              <div className={styles.worldHeroFacts}>
                <span>
                  정산 전 경과{" "}
                  <strong>
                    {formatDuration(currentSession.unsettled_seconds)}
                  </strong>
                </span>
                <span>
                  활성 장비{" "}
                  <strong>{currentSession.active_equipment_count}개</strong>
                </span>
                <span>
                  최근 정산{" "}
                  <strong>
                    {timeFormatter.format(
                      new Date(currentSession.last_settled_at),
                    )}
                  </strong>
                </span>
              </div>
            ) : (
              <div className={styles.worldHeroFacts}>
                <Link className="button button--primary" href="/start">
                  PUTDUK START 확인
                  <PutdukIcon name="arrow-right" size={18} />
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {sessions?.length ? (
        <>
          <header className={styles.sectionHeader}>
            <span>
              <p className="eyebrow">LIVE SESSIONS</p>
              <h2>현재 채굴 상태</h2>
            </span>
            <p>
              표시 값은 페이지를 연 시점의 서버 상태입니다. 금액은 정산이 완료된
              뒤 지갑에서 확인할 수 있어요.
            </p>
          </header>
          <section className={styles.sessionList} aria-label="현재 채굴 세션">
            {sessions.map((session) => {
              const status = miningStatusCopy[session.status] ?? {
                label: "상태 확인 중",
                tone: "info" as const,
              };
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
                      <dd>{formatDuration(session.unsettled_seconds)}</dd>
                    </div>
                    <div>
                      <dt>활성 장비</dt>
                      <dd>{session.active_equipment_count}개</dd>
                    </div>
                    <div>
                      <dt>시작 시각</dt>
                      <dd>
                        {timeFormatter.format(new Date(session.started_at))}
                      </dd>
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
          <p className="eyebrow">WORLD DIRECTORY</p>
          <h2>채굴 월드</h2>
        </span>
        <p>
          월드는 가상 채굴 경험의 테마입니다. 시장 가격이나 투자 수익을 추종하지
          않습니다.
        </p>
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
                        "퍼뜩의 가상 채굴 테마 월드")}
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
  );
}
