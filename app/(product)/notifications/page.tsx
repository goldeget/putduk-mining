import { NotificationInbox } from "@/components/workroom-app/notification-inbox";
import { PushControl } from "@/components/product/push-control";
import { AppInstallControl } from "@/components/system/app-experience-runtime";
import { requirePageUser } from "@/lib/auth/session";
export default async function NotificationsPage() {
  const identity = await requirePageUser("/notifications");
  return (
    <>
      <NotificationInbox key={identity.userId} />
      <section className="panel" aria-label="기기 알림과 앱 설치">
        <h2>필요한 소식을 기기로 받기</h2>
        <p>
          기기 알림과 앱 설치는 선택 사항이에요. 알림함은 언제든 사용할 수
          있어요.
        </p>
        <PushControl />
        <AppInstallControl />
      </section>
    </>
  );
}
