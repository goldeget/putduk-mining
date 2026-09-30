"use client";

import { ProductRouteError } from "@/components/product/product-route-feedback";

export default function AccountError({
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
      title="계정 화면을 열지 못했어요"
      description="연결을 확인한 뒤 다시 시도해 주세요. 로그아웃은 메뉴에서 다시 시도할 수 있어요."
    />
  );
}
