import Link from "next/link";
import type { Route } from "next";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
import {
  eventStatusPresentation,
  filterMemberVisibleEvents,
  filterMemberVisibleNotices,
  formatEventWindow,
  formatNoticePublishedAt,
  mapOwnParticipantsByEvent,
  MEMBER_VISIBLE_EVENT_STATUSES,
  participantStatusLabel,
  selectFeaturedEvent,
  sortMemberNotices,
  type MemberEventRow,
  type MemberNoticeRow,
  type MemberParticipantRow,
} from "@/domain/events/member-read-model";
import { requirePageUser } from "@/lib/auth/session";

export default async function EventsPage() {
  const identity = await requirePageUser("/events");
  const nowIso = new Date().toISOString();
  const [
    { data: eventsData, error: eventsError },
    { data: noticesData, error: noticesError },
  ] = await Promise.all([
    identity.supabase
      .from("events")
      .select(
        "id, slug, title_ko, summary_ko, status, starts_at, ends_at, published_at",
      )
      .in("status", [...MEMBER_VISIBLE_EVENT_STATUSES])
      .not("published_at", "is", null)
      .lte("published_at", nowIso)
      .order("starts_at", { ascending: false }),
    identity.supabase
      .from("notices")
      .select(
        "id, slug, title_ko, summary_ko, published_at, is_pinned, expires_at, status",
      )
      .eq("status", "PUBLISHED")
      .not("published_at", "is", null)
      .lte("published_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(8),
  ]);

  const events = filterMemberVisibleEvents(
    (eventsData ?? []) as MemberEventRow[],
    nowIso,
  );
  const notices = sortMemberNotices(
    filterMemberVisibleNotices(
      (noticesData ?? []) as MemberNoticeRow[],
      nowIso,
    ),
  );

  const eventIds = events.map((event) => event.id);
  const participantResult = eventIds.length
    ? await identity.supabase
        .from("event_participants")
        .select("event_id, status, joined_at, completed_at, rewarded_at")
        .eq("user_id", identity.userId)
        .in("event_id", eventIds)
    : { data: [], error: null };
  const { data: participants, error: participantsError } = participantResult;
  const participantByEvent = mapOwnParticipantsByEvent(
    (participants ?? []) as MemberParticipantRow[],
    identity.userId,
  );

  const featuredEvent = selectFeaturedEvent(events);
  const additionalEvents = events.filter(
    (event) => event.id !== featuredEvent?.id,
  );

  return (
    <div
      className={styles.eventPage}
      data-ui-ready="/events"
      data-ui-state={
        eventsError && noticesError
          ? "error"
          : eventsError || noticesError || participantsError
            ? "partial"
            : events.length === 0 && notices.length === 0
              ? "empty"
              : "loaded"
      }
    >
      <PageHeading
        eyebrow="EVENTS"
        title="참여할 수 있는 여정"
        lead="기간과 내 참여 상태를 확인한 뒤 선택하세요."
      />

      {eventsError ? (
        <StatePanel
          tone="error"
          title="이벤트를 불러오지 못했어요"
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 이미 달성한 기록에는 영향이 없습니다."
          action={
            <Link
              className="button button--secondary"
              href={"/events" as Route}
            >
              다시 불러오기
            </Link>
          }
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
                label={eventStatusPresentation(featuredEvent.status).label}
                tone={eventStatusPresentation(featuredEvent.status).tone}
              />
              {!participantsError &&
              participantByEvent.has(featuredEvent.id) ? (
                <ProductStatusPill
                  label={
                    participantStatusLabel(
                      participantByEvent.get(featuredEvent.id)?.status,
                    ) ?? "참여 상태 확인 중"
                  }
                  tone="info"
                />
              ) : null}
            </div>
            <h2 id="featured-event">
              <Link href={`/events/${featuredEvent.slug}` as Route}>
                {featuredEvent.title_ko}
              </Link>
            </h2>
            <p>{featuredEvent.summary_ko}</p>
            <div className={styles.eventHeroFacts}>
              <span>
                기간{" "}
                <strong>
                  {formatEventWindow(
                    featuredEvent.starts_at,
                    featuredEvent.ends_at,
                  )}
                </strong>
              </span>
              <span>
                참여 상태{" "}
                <strong>
                  {participantsError
                    ? "확인할 수 없음"
                    : participantByEvent.has(featuredEvent.id)
                      ? (participantStatusLabel(
                          participantByEvent.get(featuredEvent.id)?.status,
                        ) ?? "확인 중")
                      : "참여 기록 없음"}
                </strong>
              </span>
            </div>
            <p>
              <Link
                className="button button--secondary"
                href={`/events/${featuredEvent.slug}` as Route}
              >
                자세히 보기
              </Link>
            </p>
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
              <p className="eyebrow">MORE</p>
              <h2>다른 이벤트</h2>
            </span>
            <p>공개된 일정과 내 참여 상태만 표시합니다.</p>
          </header>
          <section className={styles.eventGrid} aria-label="이벤트 목록">
            {additionalEvents.map((event) => {
              const participant = participantByEvent.get(event.id);
              const status = eventStatusPresentation(event.status);
              const ownLabel = participantStatusLabel(participant?.status);
              return (
                <article className={styles.eventCard} key={event.id}>
                  <div className={styles.eventCardTop}>
                    <ProductStatusPill
                      label={status.label}
                      tone={status.tone}
                    />
                    <time dateTime={event.ends_at}>
                      {formatEventWindow(event.starts_at, event.ends_at)}
                    </time>
                  </div>
                  <span>
                    <h3>
                      <Link href={`/events/${event.slug}` as Route}>
                        {event.title_ko}
                      </Link>
                    </h3>
                    <p>{event.summary_ko}</p>
                  </span>
                  {ownLabel && !participantsError ? (
                    <ProductStatusPill label={ownLabel} tone="info" />
                  ) : null}
                </article>
              );
            })}
          </section>
        </>
      ) : null}

      <header className={styles.sectionHeader}>
        <span>
          <p className="eyebrow">NOTICE</p>
          <h2>공지</h2>
        </span>
        <p>퍼뜩 채굴의 중요한 변경과 이용 안내예요.</p>
      </header>

      {noticesError ? (
        <StatePanel
          tone="error"
          title="공지를 불러오지 못했어요"
          description="잠시 후 다시 확인해 주세요."
          action={
            <Link
              className="button button--secondary"
              href={"/events" as Route}
            >
              다시 불러오기
            </Link>
          }
        />
      ) : notices.length ? (
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
                  {formatNoticePublishedAt(notice.published_at)}
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
          이벤트 조건과 지급 상태는 서버에 기록된 내 참여 결과만 보여 줍니다.
        </p>
      </span>
    </div>
  );
}
