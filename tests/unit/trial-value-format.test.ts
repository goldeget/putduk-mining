import { describe, expect, it } from "vitest";

import { formatTrialValue } from "@/domain/trial/format-trial-value";

describe("trial value presentation", () => {
  it("labels pre-conversion output as a non-monetary experience unit", () => {
    expect(formatTrialValue("0")).toBe("0 체험 단위");
    expect(formatTrialValue("5000")).toBe("5,000 체험 단위");
  });

  it("never accepts decimal, signed or currency-formatted input", () => {
    for (const value of ["-1", "+1", "1.5", "1,000", "KRW 1000", ""]) {
      expect(() => formatTrialValue(value)).toThrow("INVALID_TRIAL_VALUE");
    }
  });
});
