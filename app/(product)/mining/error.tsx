"use client";

import { ProductRouteError } from "@/components/product/product-route-feedback";

export default function MiningError({
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
      title="채굴 월드를 열지 못했어요"
      description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 화면을 닫아도 서버에서 이어지는 세션에는 영향이 없습니다."
    />
  );
}
