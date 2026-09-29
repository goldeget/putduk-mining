import { afterEach, describe, expect, test } from "vitest";

import {
  formatMiningClock,
  formatMiningElapsed,
  presentMiningStatus,
} from "@/lib/product/mining-display";

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("presentMiningStatus", () => {
  test("maps the five server statuses to Korean labels", () => {
    expect(presentMiningStatus("NORMAL")).toEqual({
      label: "채굴 중",
      tone: "success",
    });
    expect(presentMiningStatus("REDUCED").label).toBe("속도 조정 중");
    expect(presentMiningStatus("MAINTENANCE").label).toBe("점검 중");
    expect(presentMiningStatus("PARTIAL_STOP").label).toBe("일부 기능 중지");
    expect(presentMiningStatus("STOPPED")).toEqual({
      label: "중지",
      tone: "danger",
    });
  });

  test("does not invent a label for an unknown status", () => {
    expect(presentMiningStatus("PAUSED")).toEqual({
      label: "상태 확인 중",
      tone: "info",
    });
    expect(presentMiningStatus(null).label).toBe("상태 확인 중");
    expect(presentMiningStatus("").label).toBe("상태 확인 중");
  });
});

describe("formatMiningElapsed", () => {
  test("formats server elapsed seconds without calculating a reward", () => {
    expect(formatMiningElapsed(0)).toBe("1분 미만");
    expect(formatMiningElapsed(59)).toBe("1분 미만");
    expect(formatMiningElapsed("90")).toBe("1분");
    expect(formatMiningElapsed(3600)).toBe("1시간");
    expect(formatMiningElapsed(5400)).toBe("1시간 30분");
  });

  test("falls back when the snapshot value is missing or not a number", () => {
    expect(formatMiningElapsed(null)).toBe("확인 중");
    expect(formatMiningElapsed(undefined)).toBe("확인 중");
    expect(formatMiningElapsed("")).toBe("확인 중");
    expect(formatMiningElapsed("soon")).toBe("확인 중");
    expect(formatMiningElapsed(Number.NaN)).toBe("확인 중");
  });
});

describe("formatMiningClock", () => {
  test("formats invalid timestamps as a calm fallback", () => {
    expect(formatMiningClock(null)).toBe("확인 중");
    expect(formatMiningClock(undefined)).toBe("확인 중");
    expect(formatMiningClock("")).toBe("확인 중");
    expect(formatMiningClock("not-a-time")).toBe("확인 중");
  });

  test("keeps Asia/Seoul when the process timezone is UTC", () => {
    process.env.TZ = "UTC";
    expect(formatMiningClock("2026-09-28T15:30:00.000Z")).toBe("오전 12:30");
    expect(formatMiningClock("2026-09-28T15:30:00.000Z")).not.toBe(
      "오후 03:30",
    );
  });
});
