"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useCallback } from "react";

import { buildWebVitalProperties } from "@/domain/analytics/observability";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

/** 표준 지표 계산과 페이지 수명 관측은 Next에 맡긴다. */
export function WebVitalsBeacon() {
  const report = useCallback<Parameters<typeof useReportWebVitals>[0]>(
    (metric) => {
      try {
        if (
          metric.name !== "LCP" &&
          metric.name !== "INP" &&
          metric.name !== "CLS"
        )
          return;
        const properties = buildWebVitalProperties({
          name: metric.name,
          raw: metric.value,
          navigationType: metric.navigationType.replace(/-/g, "_"),
        });
        if (!properties) return;
        void trackAnalyticsEvent("web_vital", properties).catch(
          () => undefined,
        );
      } catch {
        // 관측이나 수집 실패가 화면 흐름을 막으면 안 된다.
      }
    },
    [],
  );
  useReportWebVitals(report);
  return null;
}
