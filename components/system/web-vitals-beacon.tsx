"use client";

import { useEffect, useRef } from "react";

import {
  buildWebVitalProperties,
  type WebVitalName,
} from "@/domain/analytics/observability";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

type LayoutShift = PerformanceEntry & {
  hadRecentInput?: boolean;
  value?: number;
};

/**
 * LCP, INP, CLS를 한 번씩만 보낸다.
 * 관측 API가 없어도 페이지는 그대로 둔다.
 */
export function WebVitalsBeacon() {
  const sent = useRef(false);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let lcp: number | null = null;
    let inp: number | null = null;
    let cls = 0;
    let clsSupported = false;
    const observers: PerformanceObserver[] = [];

    function flush() {
      if (sent.current) return;
      sent.current = true;
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const navigationType = navigation?.type;
      const samples: { name: WebVitalName; raw: number }[] = [];
      if (lcp !== null) samples.push({ name: "LCP", raw: lcp });
      if (inp !== null) samples.push({ name: "INP", raw: inp });
      if (clsSupported) samples.push({ name: "CLS", raw: cls });
      for (const sample of samples) {
        const properties = buildWebVitalProperties(
          navigationType
            ? {
                name: sample.name,
                navigationType,
                raw: sample.raw,
              }
            : { name: sample.name, raw: sample.raw },
        );
        if (!properties) continue;
        void trackAnalyticsEvent("web_vital", properties).catch(
          () => undefined,
        );
      }
      for (const observer of observers) observer.disconnect();
    }

    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) lcp = last.startTime;
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(lcpObserver);
    } catch {
      // 이 브라우저에는 LCP가 없다.
    }

    try {
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LayoutShift[]) {
          if (entry.hadRecentInput) continue;
          cls += entry.value ?? 0;
        }
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
      clsSupported = true;
      observers.push(clsObserver);
    } catch {
      // 이 브라우저에는 CLS가 없다.
    }

    try {
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > (inp ?? 0)) inp = entry.duration;
        }
      });
      inpObserver.observe({
        type: "event",
        buffered: true,
        durationThreshold: 40,
      } as PerformanceObserverInit);
      observers.push(inpObserver);
    } catch {
      // 이 브라우저에는 이벤트 시간이 없다.
    }

    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    const timer = window.setTimeout(flush, 10_000);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      for (const observer of observers) observer.disconnect();
    };
  }, []);

  return null;
}
