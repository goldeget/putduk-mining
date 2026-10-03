import { describe, expect, it } from "vitest";

import {
  formatKstDateTimeInput,
  parseKstDateTimeInput,
} from "@/lib/time/kst-input";

describe("한국 시간 운영자 입력", () => {
  it("한국 시간 자정을 전날 UTC로 저장한다", () => {
    expect(parseKstDateTimeInput("2026-10-03T00:00")).toBe(
      "2026-10-02T15:00:00.000Z",
    );
    expect(formatKstDateTimeInput(new Date("2026-10-02T15:00:00Z"))).toBe(
      "2026-10-03T00:00",
    );
  });

  it("윤년과 입력에 포함된 초를 보존한다", () => {
    expect(parseKstDateTimeInput("2028-02-29T12:30:45.1")).toBe(
      "2028-02-29T03:30:45.100Z",
    );
  });

  it.each([
    "2026-02-29T12:00",
    "2026-02-30T12:00",
    "2026-13-01T12:00",
    "2026-10-03T24:00",
    "2026-10-03T12:60",
    "2026-10-03T12:00:60",
    "2026-10-03T12:00Z",
    "2026-10-03T12:00+09:00",
    "10/03/2026 12:00",
    "",
  ])("잘못되거나 모호한 입력을 거절한다: %s", (input) => {
    expect(parseKstDateTimeInput(input)).toBeNull();
  });

  it("서버의 로컬 시간대에 영향을 받지 않는다", () => {
    const original = process.env.TZ;
    try {
      for (const timezone of ["UTC", "America/New_York", "Asia/Seoul"]) {
        process.env.TZ = timezone;
        expect(parseKstDateTimeInput("2026-10-03T12:30")).toBe(
          "2026-10-03T03:30:00.000Z",
        );
        expect(formatKstDateTimeInput(new Date("2026-10-03T03:30:00Z"))).toBe(
          "2026-10-03T12:30",
        );
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
