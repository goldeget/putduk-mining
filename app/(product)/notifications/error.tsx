"use client";

import { ProductRouteError } from "@/components/product/product-route-feedback";

export default function NotificationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ProductRouteError
      title="알림을 불러오지 못했어요"
      description="연결을 확인한 뒤 다시 시도해 주세요. 처리 중인 금전 요청에는 영향을 주지 않습니다."
      error={error}
      reset={reset}
    />
  );
}
