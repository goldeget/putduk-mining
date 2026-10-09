import { describe, expect, it } from "vitest";

import { presentHomeCapacityProgress } from "@/lib/product/home-capacity-progress";
import { emptyMiningServerDisplay } from "@/lib/product/mining-server-display";

const display = {
  ...emptyMiningServerDisplay,
  available: true,
  effective_capacity_micro_krw: "100000000000000000000",
  used_capacity_micro_krw: "54000000000000000000",
  remaining_capacity_micro_krw: "46000000000000000000",
};

describe("authoritative capacity amounts rendered as a display ratio", () => {
  it("preserves exact ratios beyond the safe integer money range", () => {
    const before = structuredClone(display);
    expect(presentHomeCapacityProgress(display)).toEqual({
      usedBps: 5400,
      usedLabel: "54% 사용",
    });
    expect(display).toEqual(before);
  });

  it("distinguishes positive sub-basis-point usage from an unused capacity", () => {
    expect(
      presentHomeCapacityProgress({
        ...display,
        used_capacity_micro_krw: "1",
        remaining_capacity_micro_krw: "99999999999999999999",
      }),
    ).toEqual({ usedBps: 0, usedLabel: "0.01% 미만 사용" });
    expect(
      presentHomeCapacityProgress({
        ...display,
        used_capacity_micro_krw: "0",
        remaining_capacity_micro_krw: display.effective_capacity_micro_krw,
      }),
    ).toEqual({ usedBps: 0, usedLabel: "0% 사용" });
  });

  it("shows fully used capacity without exceeding the progress maximum", () => {
    expect(
      presentHomeCapacityProgress({
        ...display,
        used_capacity_micro_krw: display.effective_capacity_micro_krw,
        remaining_capacity_micro_krw: "0",
      }),
    ).toEqual({ usedBps: 10000, usedLabel: "100% 사용" });
  });

  it("discards retained numbers after a failed read", () => {
    expect(presentHomeCapacityProgress(display, true)).toBeNull();
  });

  it("renders independently truncated conserved server capacity without changing its amounts", () => {
    // Exact values 100, 33.5 and 66.5 are independently truncated by the
    // server's div(numerator * 1000000, denominator) display contract.
    const rounded = {
      ...display,
      effective_capacity_micro_krw: "100",
      used_capacity_micro_krw: "33",
      remaining_capacity_micro_krw: "66",
    };
    const before = structuredClone(rounded);
    expect(presentHomeCapacityProgress(rounded)).toEqual({
      usedBps: 3300,
      usedLabel: "33% 사용",
    });
    expect(rounded).toEqual(before);
  });

  it.each([
    { used_capacity_micro_krw: "33", remaining_capacity_micro_krw: "65" },
    { used_capacity_micro_krw: "34", remaining_capacity_micro_krw: "67" },
  ])(
    "rejects deficits beyond server rounding and any surplus: %j",
    (fields) => {
      expect(
        presentHomeCapacityProgress({
          ...display,
          effective_capacity_micro_krw: "100",
          ...fields,
        }),
      ).toBeNull();
    },
  );

  it.each([null, undefined, emptyMiningServerDisplay])(
    "never invents progress from absent authority: %s",
    (value) => expect(presentHomeCapacityProgress(value)).toBeNull(),
  );

  it.each([
    { used_capacity_micro_krw: null },
    { used_capacity_micro_krw: "-1" },
    { used_capacity_micro_krw: "1.5" },
    { used_capacity_micro_krw: "100000000000000000001" },
    { remaining_capacity_micro_krw: "1" },
    {
      effective_capacity_micro_krw: "0",
      used_capacity_micro_krw: "0",
      remaining_capacity_micro_krw: "0",
    },
  ])(
    "keeps incomplete or contradictory source amounts unknown: %j",
    (fields) => {
      expect(presentHomeCapacityProgress({ ...display, ...fields })).toBeNull();
    },
  );
});
