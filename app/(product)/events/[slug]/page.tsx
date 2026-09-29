import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import { ProductStatusPill } from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
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
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
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
  const status = eventStatusPresentation(event.status);
  const ownLabel = participantStatusLabel(participant?.status);

  return (
    <div className={styles.eventPage}>
      <PageHeading
        eyebrow="EVENTS"
        title={event.title_ko}
        lead="기간과 내 참여 상태만 표시합니다. 보상 금액은 추측하지 않습니다."
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

      <span className={styles.formNotice}>
        <PutdukIcon name="shield" size={19} />
        <p>다른 회원의 참여 기록은 보이지 않습니다.</p>
      </span>
    </div>
  );
}
