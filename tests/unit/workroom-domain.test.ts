import { describe, expect, it } from "vitest";
import {
  WORKROOM_INSTRUMENTS,
  simulationValue,
  sessionValue,
  validateWorkroomConfig,
} from "../../domain/workroom/contracts";
const base = {
  instrument: "nvda",
  pattern: "wave" as const,
  roi: 2.4,
  duration: 120,
  amplitude: 1.2,
  version: 1,
};
describe("workroom display-only domain", () => {
  it("contains exactly the approved instruments and JPY/index units", () => {
    expect(WROOM()).toEqual([
      "usd",
      "cny",
      "jpy",
      "nvda",
      "tsla",
      "msft",
      "ndx",
      "skh",
      "samsung",
      "lg",
    ]);
    expect(WORKROOM_INSTRUMENTS.find((i) => i.id === "jpy")?.unit).toBe(
      "100 JPY",
    );
    expect(WORKROOM_INSTRUMENTS.find((i) => i.id === "ndx")?.currency).toBe(
      "POINT",
    );
  });
  it.each(["wave", "slow", "balanced"] as const)(
    "freezes exact endpoints for %s even with amplitude",
    (pattern) => {
      expect(simulationValue({ ...base, pattern }, -1)).toBe(100);
      expect(simulationValue({ ...base, pattern }, 2)).toBe(102.4);
    },
  );
  it("uses epoch milliseconds and clamps early/late display", () => {
    const s = { ...base, started: 1000, stake: 50000 };
    expect(sessionValue(s, 0)).toEqual({
      progress: 0,
      value: 100,
      returned: 50000,
      remaining: 120,
    });
    expect(sessionValue(s, 121000)).toEqual({
      progress: 1,
      value: 102.4,
      returned: 51200,
      remaining: 0,
    });
  });
  it.each([
    { duration: 30.1 },
    { roi: NaN },
    { amplitude: 16 },
    { instrument: "btc" },
    { pattern: "random" },
    { duration: 29 },
    { roi: -51 },
  ])("rejects invalid configuration %j", (change) =>
    expect(() => validateWorkroomConfig({ ...base, ...change })).toThrow(),
  );
  it("accepts boundary config without mutating it", () => {
    const input = { ...base, roi: -50, amplitude: 15, duration: 3600 };
    expect(validateWorkroomConfig(input)).toEqual(input);
  });
});
function WROOM() {
  return WORKROOM_INSTRUMENTS.map((i) => i.id);
}
