import { NotificationInbox } from "../../../../../components/workroom-app/notification-inbox";
import { requireAdminPage } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { PushControl } from "../../../../../components/product/push-control";
import { AppInstallControl } from "../../../../../components/system/app-experience-runtime";
export default async function NotificationsPage() {
  const principal = await requireAdminPage("/notifications");
  if (!HIGH_IMPACT_ROLES.includes(principal.role))
    return (
      <section role="alert">
        <h1>운영 알림 권한이 필요합니다.</h1>
        <p>운영 권한을 확인해 주세요.</p>
      </section>
    );
  return (
    <>
      <NotificationInbox key={principal.adminSessionId} admin />
      <section className="panel" aria-label="운영 기기 알림과 앱 설치">
        <h2>이 기기로 운영 알림 받기</h2>
        <p>
          기기 알림과 앱 설치는 선택 사항입니다. 알림 내용은 보안 로그인 후
          확인할 수 있습니다.
        </p>
        <PushControl admin />
        <AppInstallControl />
      </section>
    </>
  );
}
