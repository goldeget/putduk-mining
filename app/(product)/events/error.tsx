"use client";

import { ProductRouteError } from "@/components/product/product-route-feedback";

export default function EventsError({
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
      title="이벤트를 열지 못했어요"
      description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 이미 달성한 참여 기록에는 영향이 없습니다."
    />
  );
}
