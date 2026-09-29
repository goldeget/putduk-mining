import Link from "next/link";

import menuStyles from "@/app/(product)/menu/menu.module.css";
import { NotificationPreferencesForm } from "@/components/product/notification-preferences-form";
import { PageHeading } from "@/components/product/page-heading";
import { PushControl } from "@/components/product/push-control";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/lib/auth/session";

const DEFAULT_PREFERENCES = {
  events_enabled: true,
  marketing_enabled: false,
  mining_enabled: true,
  service_enabled: true,
  wallet_enabled: true,
} as const;

export default async function NotificationSettingsPage() {
  const identity = await requirePageUser("/menu/notifications");
  const { data: preferences, error } = await identity.supabase
    .from("notification_preferences")
    .select(
      "mining_enabled, wallet_enabled, events_enabled, service_enabled, marketing_enabled",
    )
    .eq("user_id", identity.userId)
    .maybeSingle();

  return (
    <div className={menuStyles.settingsPage}>
      <Link className={menuStyles.backLink} href="/menu">
        <PutdukIcon name="arrow-right" size={16} aria-hidden="true" />
        <span>내 퍼뜩으로</span>
      </Link>

      <PageHeading
        eyebrow="알림"
        title="알림 설정"
        lead="받고 싶은 알림만 골라 두세요."
        action={
          <Link className="button button--secondary" href="/notifications">
            알림 센터
          </Link>
        }
      />

      {error ? (
        <StatePanel
          tone="error"
          title="알림 설정을 불러오지 못했어요"
          description="연결을 확인한 뒤 다시 시도해 주세요."
          action={
            <Link
              className="button button--secondary"
              href="/menu/notifications"
            >
              다시 불러오기
            </Link>
          }
        />
      ) : null}

      <Surface
        as="section"
        className={menuStyles.settingsPanel}
        tone="raised"
        aria-label="기기 푸시"
      >
        <PushControl />
      </Surface>

      <Surface
        as="section"
        className={menuStyles.settingsPanel}
        aria-label="알림 종류"
      >
        <div className={menuStyles.settingsHeading}>
          <p className="eyebrow">알림 종류</p>
          <h2>받을 소식 고르기</h2>
          <p>마케팅 알림은 기본으로 꺼져 있어요. 언제든 바꿀 수 있어요.</p>
        </div>
        <NotificationPreferencesForm
          initial={{
            events_enabled:
              preferences?.events_enabled ?? DEFAULT_PREFERENCES.events_enabled,
            marketing_enabled:
              preferences?.marketing_enabled ??
              DEFAULT_PREFERENCES.marketing_enabled,
            mining_enabled:
              preferences?.mining_enabled ?? DEFAULT_PREFERENCES.mining_enabled,
            service_enabled:
              preferences?.service_enabled ??
              DEFAULT_PREFERENCES.service_enabled,
            wallet_enabled:
              preferences?.wallet_enabled ?? DEFAULT_PREFERENCES.wallet_enabled,
          }}
        />
      </Surface>
    </div>
  );
}
