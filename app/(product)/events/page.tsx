import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
import { requirePageUser } from "@/lib/auth/session";

const eventStatusCopy: Record<
  string,
  { label: string; tone: ProductStatusTone }
> = {
  LIVE: { label: "진행 중", tone: "success" },
  SCHEDULED: { label: "예정", tone: "info" },
  ENDED: { label: "종료", tone: "neutral" },
  CANCELLED: { label: "취소", tone: "danger" },
};

const participantCopy: Record<string, string> = {
  JOINED: "참여 중",
  COMPLETED: "조건 달성",
  REWARDED: "보상 반영 완료",
  DISQUALIFIED: "참여 조건 확인 필요",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

function eventWindow(startsAt: string, endsAt: string) {
  return `${dateFormatter.format(new Date(startsAt))} – ${dateFormatter.format(
    new Date(endsAt),
  )}`;
}

export default async function EventsPage() {
  const identity = await requirePageUser();
  const nowIso = new Date().toISOString();
  const [
    { data: events, error: eventsError },
    { data: notices, error: noticesError },
  ] = await Promise.all([
    identity.supabase
      .from("events")
      .select(
        "id, slug, title_ko, summary_ko, status, starts_at, ends_at, published_at",
      )
      .in("status", ["LIVE", "SCHEDULED", "ENDED"])
      .order("starts_at", { ascending: false }),
    identity.supabase
      .from("notices")
      .select(
        "id, slug, title_ko, summary_ko, published_at, is_pinned, expires_at",
      )
      .eq("status", "PUBLISHED")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(8),
  ]);
  const eventIds = (events ?? []).map((event) => event.id);
  const participantResult = eventIds.length
    ? await identity.supabase
        .from("event_participants")
        .select("event_id, status, joined_at, completed_at, rewarded_at")
        .eq("user_id", identity.userId)
        .in("event_id", eventIds)
    : { data: [], error: null };
  const { data: participants, error: participantsError } = participantResult;
  const participantByEvent = new Map(
    (participants ?? []).map((participant) => [
      participant.event_id,
      participant,
    ]),
  );
  const featuredEvent =
    events?.find((event) => event.status === "LIVE") ??
    events?.find((event) => event.status === "SCHEDULED") ??
    events?.[0];
  const additionalEvents = (events ?? []).filter(
    (event) => event.id !== featuredEvent?.id,
  );

  return (
    <div className={styles.eventPage}>
      <PageHeading
        eyebrow="EVENTS & MISSIONS"
        title="지금 참여할 수 있는 여정"
        lead="기간과 참여 상태를 먼저 확인하고 선택할 수 있도록 안내합니다. 보상은 공개된 조건을 달성한 경우에만 실제 처리 결과로 반영됩니다."
      />

      {eventsError ? (
        <StatePanel
          tone="error"
          title="이벤트를 불러오지 못했어요"
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 이미 달성한 기록에는 영향이 없습니다."
        />
      ) : featuredEvent ? (
        <section className={styles.eventHero} aria-labelledby="featured-event">
          <picture className={styles.eventHeroPicture}>
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
            />
          </picture>
          <div className={styles.eventHeroContent}>
            <div className={styles.eventHeroMeta}>
              <ProductStatusPill
                label={
                  eventStatusCopy[featuredEvent.status]?.label ?? "상태 확인 중"
                }
                tone={eventStatusCopy[featuredEvent.status]?.tone ?? "neutral"}
              />
              {!participantsError &&
              participantByEvent.has(featuredEvent.id) ? (
                <ProductStatusPill
                  label={
                    participantCopy[
                      participantByEvent.get(featuredEvent.id)?.status ?? ""
                    ] ?? "참여 상태 확인 중"
                  }
                  tone="info"
                />
              ) : null}
            </div>
            <h2 id="featured-event">{featuredEvent.title_ko}</h2>
            <p>{featuredEvent.summary_ko}</p>
            <div className={styles.eventHeroFacts}>
              <span>
                기간{" "}
                <strong>
                  {eventWindow(featuredEvent.starts_at, featuredEvent.ends_at)}
                </strong>
              </span>
              <span>
                참여 상태{" "}
                <strong>
                  {participantsError
                    ? "확인할 수 없음"
                    : participantByEvent.has(featuredEvent.id)
                      ? (participantCopy[
                          participantByEvent.get(featuredEvent.id)?.status ?? ""
                        ] ?? "확인 중")
                      : "참여 기록 없음"}
                </strong>
              </span>
            </div>
          </div>
        </section>
      ) : (
        <StatePanel
          title="현재 공개된 이벤트가 없어요"
          description="새로운 이벤트가 시작되면 기간과 참여 조건을 이곳에서 확인할 수 있어요."
        />
      )}

      {additionalEvents.length ? (
        <>
          <header className={styles.sectionHeader}>
            <span>
              <p className="eyebrow">MORE JOURNEYS</p>
              <h2>다른 이벤트</h2>
            </span>
            <p>실제 공개된 일정과 내 참여 상태만 표시합니다.</p>
          </header>
          <section className={styles.eventGrid} aria-label="이벤트 목록">
            {additionalEvents.map((event) => {
              const participant = participantByEvent.get(event.id);
              const status = eventStatusCopy[event.status] ?? {
                label: "상태 확인 중",
                tone: "neutral" as const,
              };
              return (
                <article className={styles.eventCard} key={event.id}>
                  <div className={styles.eventCardTop}>
                    <ProductStatusPill
                      label={status.label}
                      tone={status.tone}
                    />
                    <time dateTime={event.ends_at}>
                      {eventWindow(event.starts_at, event.ends_at)}
                    </time>
                  </div>
                  <span>
                    <small>{event.slug.toUpperCase()}</small>
                    <h3>{event.title_ko}</h3>
                    <p>{event.summary_ko}</p>
                  </span>
                  {participant && !participantsError ? (
                    <ProductStatusPill
                      label={
                        participantCopy[participant.status] ??
                        "참여 상태 확인 중"
                      }
                      tone="info"
                    />
                  ) : null}
                </article>
              );
            })}
          </section>
        </>
      ) : null}

      <header className={styles.sectionHeader}>
        <span>
          <p className="eyebrow">OFFICIAL UPDATES</p>
          <h2>공지</h2>
        </span>
        <p>퍼뜩 채굴의 중요한 변경과 이용 안내를 확인하세요.</p>
      </header>

      {noticesError ? (
        <StatePanel
          tone="error"
          title="공지를 불러오지 못했어요"
          description="잠시 후 다시 확인해 주세요."
        />
      ) : notices?.length ? (
        <section className={styles.noticeList} aria-label="공지 목록">
          {notices.map((notice) => (
            <article className={styles.noticeItem} key={notice.id}>
              <span>
                <strong>
                  {notice.is_pinned ? "중요 · " : ""}
                  {notice.title_ko}
                </strong>
                <p>{notice.summary_ko}</p>
              </span>
              {notice.published_at ? (
                <time dateTime={notice.published_at}>
                  {dateFormatter.format(new Date(notice.published_at))}
                </time>
              ) : null}
            </article>
          ))}
        </section>
      ) : (
        <StatePanel
          title="새로운 공지가 없어요"
          description="꼭 확인해야 할 소식이 생기면 이곳과 알림 센터에서 안내해 드려요."
        />
      )}

      <span className={styles.formNotice}>
        <PutdukIcon name="shield" size={19} />
        <p>
          이벤트 조건과 지급 상태는 화면에 표시된 실제 기록을 기준으로
          확인하세요. 확인되지 않은 보상이나 진행률은 표시하지 않습니다.
        </p>
      </span>
    </div>
  );
}
