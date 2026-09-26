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
      // Analytics must never block or alter the user flow.
    });
  }, [pathname]);

  return null;
}
