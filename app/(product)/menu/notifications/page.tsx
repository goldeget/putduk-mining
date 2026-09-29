import { NotificationPreferencesForm } from "@/components/product/notification-preferences-form";
import { PageHeading } from "@/components/product/page-heading";
import { PushControl } from "@/components/product/push-control";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

export default async function NotificationSettingsPage() {
  const identity = await requirePageUser("/menu/notifications");
  const { data: preferences } = await identity.supabase
    .from("notification_preferences")
    .select(
      "mining_enabled, wallet_enabled, events_enabled, service_enabled, marketing_enabled",
    )
    .eq("user_id", identity.userId)
    .maybeSingle();

  return (
    <>
      <PageHeading
        eyebrow="알림 설정"
        title="필요한 순간에만, 명확한 알림."
        lead="첫 화면에서 권한을 요구하지 않습니다. 직접 선택한 기기에만 푸시를 저장합니다."
      />
      <Surface as="section" className="settings-panel" tone="raised">
        <PushControl />
      </Surface>
      <Surface
        as="section"
        className="settings-panel settings-panel--preferences"
      >
        <div className="settings-panel__heading">
          <p className="eyebrow">알림 종류</p>
          <h2>받고 싶은 소식</h2>
          <p>마케팅 알림은 기본으로 꺼져 있으며 언제든 다시 선택할 수 있습니다.</p>
        </div>
        <NotificationPreferencesForm
          initial={{
            events_enabled: preferences?.events_enabled ?? true,
            marketing_enabled: preferences?.marketing_enabled ?? false,
            mining_enabled: preferences?.mining_enabled ?? true,
            service_enabled: preferences?.service_enabled ?? true,
            wallet_enabled: preferences?.wallet_enabled ?? true,
          }}
        />
      </Surface>
    </>
  );
}
