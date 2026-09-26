import { describe, expect, it } from "vitest";

import { formatProductDateTime, toCanonicalUtcIso } from "@/lib/i18n/date-time";

describe("date and time boundaries", () => {
  it("stores a canonical UTC timestamp", () => {
    expect(toCanonicalUtcIso(new Date("2026-09-27T09:00:00+09:00"))).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });

  it("keeps a locale seam for Korea and Japan", () => {
    const instant = "2026-09-27T00:00:00.000Z";
    expect(formatProductDateTime(instant, "ko-KR")).toContain("9:00");
    expect(formatProductDateTime(instant, "ja-JP")).toContain("9:00");
  });
});
