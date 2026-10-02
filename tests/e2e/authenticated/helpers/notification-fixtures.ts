import { randomUUID } from "node:crypto";

import { execLocalAdminSql } from "./local-db";

export type SeededMemberNotification = {
  body: string;
  category: string;
  id: string;
  route: string | null;
  title: string;
};

/**
 * 브라우저가 읽을 인앱 알림 행만 로컬 관리 연결로 넣는다.
 * 발행 권한·outbox fanout·service_role GRANT·test RPC는 건드리지 않는다.
 */
export function seedMemberNotification(input: {
  body: string;
  category: string;
  createdAt?: string;
  expiresAt?: string | null;
  readAt?: string | null;
  route?: string | null;
  title: string;
  userId: string;
}): SeededMemberNotification {
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt === undefined ? null : input.expiresAt;
  let readAt = input.readAt ?? null;
  if (readAt && readAt < createdAt) {
    readAt = createdAt;
  }
  const route = input.route ?? null;
  const dedupe = `e2e-notif-${id}`;

  const inserted = execLocalAdminSql(
    `with inserted as (
      insert into public.notifications (
        id,
        user_id,
        category,
        title_ko,
        body_ko,
        route,
        read_at,
        expires_at,
        created_at,
        deduplication_key,
        priority,
        scheduled_at
      )
      values (
        :'notification_id'::uuid,
        :'user_id'::uuid,
        :'category',
        :'title_ko',
        :'body_ko',
        nullif(:'route', ''),
        nullif(:'read_at', '')::timestamptz,
        nullif(:'expires_at', '')::timestamptz,
        :'created_at'::timestamptz,
        :'dedupe',
        100,
        :'created_at'::timestamptz
      )
      returning id
    )
    select count(*) from inserted`,
    {
      body_ko: input.body,
      category: input.category,
      created_at: createdAt,
      dedupe,
      expires_at: expiresAt ?? "",
      notification_id: id,
      read_at: readAt ?? "",
      route: route ?? "",
      title_ko: input.title,
      user_id: input.userId,
    },
  );

  if (Number(inserted) !== 1) {
    throw new Error(`NOTIFICATION_FIXTURE_INSERT:${inserted}`);
  }

  return {
    body: input.body,
    category: input.category,
    id,
    route,
    title: input.title,
  };
}

export function seedUnsafeRouteNotification(userId: string) {
  // DB는 상대 경로만 허용한다. /login 은 저장되지만 멤버 allowlist 밖이다.
  return seedMemberNotification({
    body: "이 링크는 화면에 나오면 안 돼요.",
    category: "service",
    route: "/login",
    title: "허용되지 않은 경로 알림",
    userId,
  });
}

export function seedExpiredNotification(userId: string) {
  const past = new Date(Date.now() - 60_000).toISOString();
  const older = new Date(Date.now() - 120_000).toISOString();
  return seedMemberNotification({
    body: "만료된 알림은 목록에 없어야 해요.",
    category: "service",
    createdAt: older,
    expiresAt: past,
    title: "만료된 알림",
    userId,
  });
}
