import { randomUUID } from "node:crypto";

import { execLocalAdminSql } from "./local-db";

/**
 * 브라우저 Events 증거용 행은 로컬 데이터베이스 관리 연결로만 넣는다.
 * 운영 마이그레이션·seed·service_role GRANT·test RPC로는 만들지 않는다.
 * 보상 금액·경제 값은 넣지 않는다.
 */

export type SeededEventsBundle = {
  draftSlug: string;
  endedSlug: string;
  expiredNoticeSlug: string;
  liveSlug: string;
  pinnedNoticeTitle: string;
  scheduledSlug: string;
  unpublishedNoticeSlug: string;
};

function requireCount(actual: string, expected: number, label: string) {
  if (Number(actual) !== expected) {
    throw new Error(`${label}:${actual}`);
  }
}

function fixtureSlug(label: string) {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  return `e2e-${label}-${suffix}`;
}

/** 이전 레인 실행에서 남은 e2e-% fixture만 제거한다. 운영 콘텐츠는 건드리지 않는다. */
export function cleanupE2eEventsFixtures() {
  execLocalAdminSql(
    `
    delete from public.event_participants
    where event_id in (
      select id from public.events where slug like 'e2e-%'
    );
    delete from public.events where slug like 'e2e-%';
    delete from public.notices where slug like 'e2e-%';
    select 1
    `,
  );
}

export function countPublishedMemberEvents(): number {
  const count = execLocalAdminSql(
    `
    select count(*)::text
    from public.events
    where published_at is not null
      and published_at <= statement_timestamp()
      and status in ('LIVE', 'SCHEDULED', 'ENDED')
    `,
  );
  return Number(count);
}

export function countPublishedMemberNotices(): number {
  const count = execLocalAdminSql(
    `
    select count(*)::text
    from public.notices
    where status = 'PUBLISHED'
      and published_at is not null
      and published_at <= statement_timestamp()
      and (expires_at is null or expires_at > statement_timestamp())
    `,
  );
  return Number(count);
}

export async function seedMemberEventsReadModel(input: {
  otherUserId: string;
  viewerUserId: string;
}): Promise<SeededEventsBundle> {
  if (
    !/^[0-9a-f-]{36}$/i.test(input.viewerUserId) ||
    !/^[0-9a-f-]{36}$/i.test(input.otherUserId)
  ) {
    throw new Error("EVENTS_FIXTURE_USER_ID");
  }

  const liveSlug = fixtureSlug("live");
  const scheduledSlug = fixtureSlug("sched");
  const endedSlug = fixtureSlug("ended");
  const draftSlug = fixtureSlug("draft");
  const pinnedNoticeSlug = fixtureSlug("pin");
  const expiredNoticeSlug = fixtureSlug("exp");
  const unpublishedNoticeSlug = fixtureSlug("draft-n");
  // psql -v 값에 공백을 넣지 않는다.
  const pinnedNoticeTitle = `고정공지-${pinnedNoticeSlug.slice(-6)}`;

  const liveId = randomUUID();
  const scheduledId = randomUUID();
  const endedId = randomUUID();
  const draftId = randomUUID();

  const inserted = execLocalAdminSql(
    `
    with events_ins as (
      insert into public.events (
        id, slug, title_ko, summary_ko, status, starts_at, ends_at, published_at
      )
      values
        (
          :'live_id'::uuid,
          :'live_slug',
          '로컬 진행 이벤트',
          '브라우저 검증용 진행 중 이벤트입니다.',
          'LIVE',
          statement_timestamp() - interval '2 days',
          statement_timestamp() + interval '5 days',
          statement_timestamp() - interval '3 days'
        ),
        (
          :'scheduled_id'::uuid,
          :'scheduled_slug',
          '로컬 예정 이벤트',
          '브라우저 검증용 예정 이벤트입니다.',
          'SCHEDULED',
          statement_timestamp() + interval '2 days',
          statement_timestamp() + interval '7 days',
          statement_timestamp() - interval '1 day'
        ),
        (
          :'ended_id'::uuid,
          :'ended_slug',
          '로컬 종료 이벤트',
          '브라우저 검증용 종료 이벤트입니다.',
          'ENDED',
          statement_timestamp() - interval '10 days',
          statement_timestamp() - interval '1 day',
          statement_timestamp() - interval '12 days'
        ),
        (
          :'draft_id'::uuid,
          :'draft_slug',
          '로컬 초안 이벤트',
          '공개되면 안 되는 초안입니다.',
          'DRAFT',
          statement_timestamp() + interval '1 day',
          statement_timestamp() + interval '3 days',
          null
        )
      returning id
    ),
    participants_ins as (
      insert into public.event_participants (
        event_id, user_id, status, joined_at
      )
      values
        (
          :'live_id'::uuid,
          :'viewer_id'::uuid,
          'JOINED',
          statement_timestamp() - interval '1 day'
        ),
        (
          :'live_id'::uuid,
          :'other_id'::uuid,
          'REWARDED',
          statement_timestamp() - interval '2 days'
        ),
        (
          :'ended_id'::uuid,
          :'viewer_id'::uuid,
          'COMPLETED',
          statement_timestamp() - interval '8 days'
        )
      returning id
    ),
    notices_ins as (
      insert into public.notices (
        slug, title_ko, summary_ko, body_markdown, status, is_pinned,
        published_at, expires_at
      )
      values
        (
          :'pinned_slug',
          :'pinned_title',
          '고정된 공개 공지입니다.',
          '고정 공지 본문',
          'PUBLISHED',
          true,
          statement_timestamp() - interval '2 days',
          null
        ),
        (
          :'expired_slug',
          '만료된 공지',
          '만료되어 목록에 나오면 안 됩니다.',
          '만료 공지 본문',
          'PUBLISHED',
          false,
          statement_timestamp() - interval '10 days',
          statement_timestamp() - interval '1 day'
        ),
        (
          :'draft_notice_slug',
          '미공개 공지',
          '초안 공지는 목록에 나오면 안 됩니다.',
          '초안 공지 본문',
          'DRAFT',
          false,
          null,
          null
        )
      returning id
    )
    select
      (select count(*) from events_ins)::text || ',' ||
      (select count(*) from participants_ins)::text || ',' ||
      (select count(*) from notices_ins)::text
    `,
    {
      draft_id: draftId,
      draft_notice_slug: unpublishedNoticeSlug,
      draft_slug: draftSlug,
      ended_id: endedId,
      ended_slug: endedSlug,
      expired_slug: expiredNoticeSlug,
      live_id: liveId,
      live_slug: liveSlug,
      other_id: input.otherUserId,
      pinned_slug: pinnedNoticeSlug,
      pinned_title: pinnedNoticeTitle,
      scheduled_id: scheduledId,
      scheduled_slug: scheduledSlug,
      viewer_id: input.viewerUserId,
    },
  );

  requireCount(inserted.split(",")[0] ?? "", 4, "EVENTS_FIXTURE_EVENTS");
  requireCount(inserted.split(",")[1] ?? "", 3, "EVENTS_FIXTURE_PARTICIPANTS");
  requireCount(inserted.split(",")[2] ?? "", 3, "EVENTS_FIXTURE_NOTICES");

  return {
    draftSlug,
    endedSlug,
    expiredNoticeSlug,
    liveSlug,
    pinnedNoticeTitle,
    scheduledSlug,
    unpublishedNoticeSlug,
  };
}
