"use client";

import { ProductRouteError } from "@/components/product/product-route-feedback";

export default function WalletError({
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
      title="지갑을 열지 못했어요"
      description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 실제 잔액과 접수된 요청에는 영향이 없습니다."
    />
  );
}
