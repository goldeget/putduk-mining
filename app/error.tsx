"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/states";
import { buildClientErrorProperties } from "@/domain/analytics/observability";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

export default function ErrorPage({
  error,
  retry,
  reset,
}: {
  error: unknown;
  retry?: (() => void) | undefined;
  reset?: (() => void) | undefined;
}) {
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const properties = buildClientErrorProperties(error);
    const key = `${properties.error_name}:${properties.error_digest ?? ""}`;
    if (reported.current === key) return;
    reported.current = key;
    void trackAnalyticsEvent("client_error", properties).catch(() => undefined);
  }, [error]);

  return (
    <main className="shell">
      <StatePanel
        headingLevel={1}
        tone="error"
        title="화면을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요. 문제가 계속되면 상태 페이지에서 서비스 상황을 확인할 수 있습니다."
        action={
          <Button onClick={retry ?? reset} disabled={!retry && !reset}>
            다시 시도
          </Button>
        }
      />
    </main>
  );
}
