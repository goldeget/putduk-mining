"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { trackAnalyticsEvent } from "@/lib/analytics/client";

export function AnalyticsBeacon() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      lastTrackedPath.current === pathname
    ) {
      return;
    }

    lastTrackedPath.current = pathname;
    void trackAnalyticsEvent("screen_view", { path: pathname }).catch(() => {
      // 분석 실패가 화면 전환을 바꾸면 안 된다.
    });
    if (pathname === "/") {
      void trackAnalyticsEvent("landing_view", { path: pathname }).catch(() => {
        // 첫 이벤트도 같은 방식으로 버린다.
      });
    }
  }, [pathname]);

  return null;
}
