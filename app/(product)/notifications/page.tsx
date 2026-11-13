import { NotificationInbox } from "@/components/workroom-app/notification-inbox";
import { DeviceSettings } from "@/components/workroom-app/device-settings";
import { requirePageUser } from "@/lib/auth/session";
export default async function NotificationsPage() {
  const identity = await requirePageUser("/notifications");
  return (
    <>
      <NotificationInbox key={identity.userId} />
      <DeviceSettings />
    </>
  );
}
