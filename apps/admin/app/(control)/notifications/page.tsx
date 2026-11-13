import { NotificationInbox } from "../../../../../components/workroom-app/notification-inbox";
import { requireAdminPage } from "@/lib/auth/principal";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { DeviceSettings } from "../../../../../components/workroom-app/device-settings";
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
      <DeviceSettings admin />
    </>
  );
}
