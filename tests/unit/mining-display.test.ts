import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { beforeAll, describe, expect, test } from "vitest";

import {
  formatMiningClock,
  formatMiningElapsed,
  miningRouteLoadingLabel,
  presentMiningStatus,
} from "@/lib/product/mining-display";

test("mining route loading status is a short Korean announcement", () => {
  expect(miningRouteLoadingLabel).toBe("채굴 월드 불러오는 중");
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
});

describe("formatMiningClock in a UTC process", () => {
  let utcProcess: SpawnSyncReturns<string>;

  beforeAll(
    () => {
      const moduleUrl = new URL(
        "../../lib/product/mining-display.ts",
        import.meta.url,
      ).href;
      const script = `
        const timestamp = "2026-09-28T15:30:00.000Z";
        const defaultZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
        const ordinaryUtc = new Intl.DateTimeFormat("ko-KR", {
          hour: "2-digit", minute: "2-digit",
        }).format(new Date(timestamp));
        const { formatMiningClock } = await import(${JSON.stringify(moduleUrl)});
        process.stdout.write(JSON.stringify({
          defaultZone, ordinaryUtc, actualSeoul: formatMiningClock(timestamp),
        }));
      `;
      utcProcess = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", script],
        {
          encoding: "utf8",
          env: { ...process.env, TZ: "UTC" },
          maxBuffer: 64 * 1024,
          timeout: process.platform === "win32" ? 25_000 : 8_000,
          windowsHide: true,
        },
      );
    },
    process.platform === "win32" ? 30_000 : 10_000,
  );

  test("keeps Asia/Seoul when the process timezone is UTC", () => {
    expect(utcProcess.error).toBeUndefined();
    expect(utcProcess.signal).toBeNull();
    expect(utcProcess.status, utcProcess.stderr).toBe(0);
    const evidence = JSON.parse(utcProcess.stdout) as Record<string, unknown>;
    expect(evidence).toEqual({
      defaultZone: "UTC",
      ordinaryUtc: "오후 03:30",
      actualSeoul: "오전 12:30",
    });
    expect(evidence.actualSeoul).not.toBe("오후 03:30");
  });
});
