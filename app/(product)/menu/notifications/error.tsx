"use client";

import { ProductRouteError } from "@/components/product/product-route-feedback";

export default function NotificationSettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ProductRouteError
      error={error}
      reset={reset}
      title="알림 설정을 열지 못했어요"
      description="연결을 확인한 뒤 다시 시도해 주세요."
    />
  );
}
