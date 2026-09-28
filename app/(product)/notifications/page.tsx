import Link from "next/link";

import { NotificationItem } from "@/components/product/notification-item";
import { PageHeading } from "@/components/product/page-heading";
import { PushControl } from "@/components/product/push-control";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

export default async function NotificationCenterPage() {
  const identity = await requirePageUser("/notifications");
  const { data: notifications, error } = await identity.supabase
    .from("notifications")
    .select("id, category, title_ko, body_ko, route, read_at, created_at")
    .eq("user_id", identity.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const unread = notifications?.filter((item) => !item.read_at).length ?? 0;

  return (
    <>
      <PageHeading
        eyebrow="NOTIFICATION CENTER"
        title={unread ? `새 소식 ${unread}개` : "중요한 변화를 놓치지 않도록."}
        lead="채굴·지갑·이벤트 안내를 한곳에서 확인하세요."
        action={
          <Link className="button button--secondary" href="/menu/notifications">
            알림 설정
          </Link>
        }
      />
      <div className="notification-center">
        <section aria-label="알림 목록">
          {error ? (
            <StatePanel
              tone="error"
              title="알림을 불러오지 못했어요"
              description="연결을 확인한 뒤 다시 시도해 주세요. 처리 중인 금전 요청에는 영향을 주지 않습니다."
            />
          ) : notifications?.length ? (
            notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={{
                  body: notification.body_ko,
                  category: notification.category,
                  createdAt: notification.created_at,
                  id: notification.id,
                  read: Boolean(notification.read_at),
                  route: notification.route,
                  title: notification.title_ko,
                }}
              />
            ))
          ) : (
            <StatePanel
              title="아직 도착한 알림이 없어요"
              description="채굴 결과나 지갑 변화가 생기면 이곳에서 알려드릴게요."
            />
          )}
        </section>
        <Surface as="aside" className="notification-center__push" tone="raised">
          <p className="eyebrow">PWA PUSH</p>
          <h2>필요한 소식만 기기로 받기</h2>
          <p>
            권한은 선택한 뒤에만 요청해요. 마케팅 알림은 기본으로 꺼져 있어요.
          </p>
          <PushControl />
        </Surface>
      </div>
    </>
  );
}
