import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
import { EventParticipation } from "@/components/product/event-participation";
import {
  canJoinMemberEvent,
  memberEventAwardSchema,
  memberEventContentSchema,
} from "@/domain/events/participation";
import {
  eventStatusPresentation,
  formatEventWindow,
  isMemberVisibleEvent,
  MEMBER_VISIBLE_EVENT_STATUSES,
  participantStatusLabel,
  type MemberEventRow,
  type MemberParticipantRow,
} from "@/domain/events/member-read-model";
import { requirePageUser } from "@/lib/auth/session";

type EventsDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EventsDetailPage({
  params,
}: EventsDetailPageProps) {
  const { slug } = await params;
  if (slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    notFound();
  }

  const returnPath = `/events/${slug}`;
  const identity = await requirePageUser(returnPath);
  const nowIso = new Date().toISOString();

  const { data: eventData, error: eventError } = await identity.supabase
    .from("events")
    .select(
      "id, slug, title_ko, summary_ko, status, starts_at, ends_at, published_at",
    )
    .eq("slug", slug)
    .in("status", [...MEMBER_VISIBLE_EVENT_STATUSES])
    .not("published_at", "is", null)
    .lte("published_at", nowIso)
    .maybeSingle();

  if (eventError) {
    return (
      <div className={styles.eventPage}>
        <PageHeading
          eyebrow="EVENTS"
          title="이벤트 상세"
          lead="선택한 이벤트의 기간과 내 참여 상태를 확인합니다."
        />
        <StatePanel
          tone="error"
          title="이벤트를 불러오지 못했어요"
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          action={
            <Link
              className="button button--secondary"
              href={returnPath as Route}
            >
              다시 불러오기
            </Link>
          }
        />
      </div>
    );
  }

  const event = eventData as MemberEventRow | null;
  if (!event || !isMemberVisibleEvent(event, nowIso)) {
    return (
      <div className={styles.eventPage}>
        <PageHeading
          eyebrow="EVENTS"
          title="이벤트 상세"
          lead="선택한 이벤트의 기간과 내 참여 상태를 확인합니다."
        />
        <StatePanel
          title="공개된 이벤트를 찾을 수 없어요"
          description="주소가 바뀌었거나 아직 공개되지 않은 이벤트일 수 있어요."
          action={
            <Link
              className="button button--secondary"
              href={"/events" as Route}
            >
              이벤트 목록으로
            </Link>
          }
        />
      </div>
    );
  }

  const { data: participantData, error: participantsError } =
    await identity.supabase
      .from("event_participants")
      .select("event_id, status, joined_at, completed_at, rewarded_at")
      .eq("user_id", identity.userId)
      .eq("event_id", event.id)
      .maybeSingle();

  const participant = participantData as MemberParticipantRow | null;
  const { data: contentData, error: contentError } = await identity.supabase
    .from("event_member_content")
    .select(
      "event_id,revision_id,body_ko,participation_ko,exclusion_ko,cta_label,cta_route,reward_mode",
    )
    .eq("event_id", event.id)
    .maybeSingle();
  const parsedContent = memberEventContentSchema.safeParse(contentData);
  const content =
    !contentError &&
    parsedContent.success &&
    parsedContent.data.event_id === event.id
      ? parsedContent.data
      : null;
  const status = eventStatusPresentation(event.status);
  const ownLabel = participantStatusLabel(participant?.status);
  // Own-row RLS plus column grants keep original, policy, and qualification private.
  const awardResult = participant
    ? await identity.supabase
        .from("member_event_awards")
        .select("id,event_id,reward_kind,title_ko,created_at")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  const parsedAwards = memberEventAwardSchema
    .array()
    .safeParse(awardResult.data);
  const awards =
    !awardResult.error &&
    parsedAwards.success &&
    parsedAwards.data.every((row) => row.event_id === event.id)
      ? parsedAwards.data
      : null;

  return (
    <div className={styles.eventPage}>
      <PageHeading
        eyebrow="EVENTS"
        title={event.title_ko}
        lead="참여 조건과 기간을 확인하세요."
      />

      <section
        className={styles.eventHero}
        aria-labelledby="event-detail-title"
      >
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
            <ProductStatusPill label={status.label} tone={status.tone} />
            {ownLabel && !participantsError ? (
              <ProductStatusPill label={ownLabel} tone="info" />
            ) : null}
          </div>
          <h2 id="event-detail-title">{event.title_ko}</h2>
          <p>{event.summary_ko}</p>
          <div className={styles.eventHeroFacts}>
            <span>
              기간{" "}
              <strong>
                {formatEventWindow(event.starts_at, event.ends_at)}
              </strong>
            </span>
            <span>
              참여 상태{" "}
              <strong>
                {participantsError
                  ? "확인할 수 없음"
                  : (ownLabel ?? "참여 기록 없음")}
              </strong>
            </span>
          </div>
          <p>
            <Link
              className="button button--secondary"
              href={"/events" as Route}
            >
              목록으로
            </Link>
          </p>
        </div>
      </section>

      {content ? (
        <section className={styles.eventCard} aria-label="이벤트 참여 안내">
          <h2>참여 안내</h2>
          <p
            style={{
              whiteSpace: "pre-wrap",
              maxWidth: "38rem",
              overflowWrap: "anywhere",
            }}
          >
            {content.body_ko}
          </p>
          <h3>참여 조건</h3>
          <p>{content.participation_ko}</p>
          <h3>유의 사항</h3>
          <p>{content.exclusion_ko}</p>
          <p>현금 보상이 없는 이벤트예요.</p>
          {participantsError ? (
            <StatePanel
              tone="error"
              title="참여 상태를 확인하지 못했어요"
              description="다시 불러온 뒤 참여해 주세요."
            />
          ) : (
            <EventParticipation
              eventId={event.id}
              revisionId={content.revision_id}
              canJoin={canJoinMemberEvent(
                event.status,
                event.starts_at,
                event.ends_at,
                nowIso,
              )}
              joined={Boolean(participant)}
            />
          )}
          <Link
            className="button button--secondary"
            href={content.cta_route as Route}
          >
            {content.cta_label}
          </Link>
        </section>
      ) : (
        <StatePanel
          tone="error"
          title="참여 안내를 확인할 수 없어요"
          description="잠시 후 다시 확인해 주세요."
        />
      )}

      {participant && !participantsError ? (
        <section className={styles.eventCard} aria-label="내 달성 기록">
          <h2>내 달성 기록</h2>
          {awards === null ? (
            <StatePanel
              tone="error"
              title="달성 기록을 확인하지 못했어요"
              description="연결을 확인하고 다시 열어 주세요."
            />
          ) : awards.length ? (
            <ul>
              {awards.map((award) => (
                <li key={award.id}>
                  <strong>{award.title_ko}</strong>{" "}
                  <span>
                    {award.reward_kind === "BADGE" ? "배지" : "프로필 칭호"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>아직 기록된 달성이 없어요. 참여 조건을 확인해 주세요.</p>
          )}
        </section>
      ) : null}

      <span className={styles.formNotice}>
        <PutdukIcon name="shield" size={19} />
        <p>다른 회원의 참여 기록은 보이지 않습니다.</p>
      </span>
    </div>
  );
}
