import { describe, expect, it } from "vitest";
import {
  emptyMiningServerDisplay,
  parseMiningServerDisplay,
  presentMiningServerDisplay,
  type FundedRuntimeDisplay,
} from "@/lib/product/mining-server-display";

const runtime: FundedRuntimeDisplay = {
  schema_version: 1,
  runtime_version: 2,
  state_revision: "3",
  condition_revision: "3",
  accepted_cursor_at: "2026-10-06T11:00:00.123456Z",
  evaluated_at: "2026-10-06T11:00:01.234567Z",
  allocation_bps: "5000",
  committed_reward_total_atomic: "12",
  reward_carry: { numerator: "73", denominator: "100", unit: "KRW" },
  conditional_maintenance: {
    numerator: "1273",
    denominator: "100",
    unit: "KRW",
    qualification: "UNCONFIRMED",
  },
};
function snapshot(funded_runtime: unknown = runtime) {
  return {
    ...emptyMiningServerDisplay,
    available: true,
    pending_micro_krw: "730000",
    retention_unconfirmed_micro_krw: "12730000",
    funded_runtime,
  };
}

describe("original-bound funded display envelope", () => {
  it("preserves exact carry and conditional maintenance separately from confirmed reward history", () => {
    const parsed = parseMiningServerDisplay(snapshot());
    expect(parsed?.funded_runtime).toEqual(runtime);
    expect(parsed?.pending_micro_krw).toBe("730000");
    expect(parsed?.retention_unconfirmed_micro_krw).toBe("12730000");
    const presented = presentMiningServerDisplay(parsed!);
    expect(presented).toMatchObject({ state: "ready" });
    if (presented.state === "ready") {
      expect(presented.rows).toContainEqual({
        label: "채굴 확정 누계",
        value: "12원",
      });
      expect(presented.rows).toContainEqual({
        label: "정산 전",
        value: "1원 미만",
      });
      expect(presented.rows).toContainEqual({
        label: "확인 전",
        value: "약 12원",
      });
      expect(presented.rows.some((row) => row.label.includes("지갑"))).toBe(
        false,
      );
    }
  });

  it("accepts the existing legacy DTO without fabricating runtime facts", () => {
    expect(parseMiningServerDisplay(emptyMiningServerDisplay)).toEqual(
      emptyMiningServerDisplay,
    );
    expect(
      parseMiningServerDisplay(emptyMiningServerDisplay)?.funded_runtime,
    ).toBeUndefined();
  });

  it.each([
    ["caller-shaped amount", { ...runtime, amount_atomic: "9999" }],
    [
      "zero denominator",
      {
        ...runtime,
        reward_carry: { ...runtime.reward_carry, denominator: "0" },
      },
    ],
    [
      "already whole carry",
      {
        ...runtime,
        reward_carry: { ...runtime.reward_carry, numerator: "100" },
      },
    ],
    ["float money", { ...runtime, committed_reward_total_atomic: "12.73" }],
    [
      "future accepted cursor",
      { ...runtime, accepted_cursor_at: "2026-10-07T00:00:00Z" },
    ],
    [
      "future submillisecond cursor",
      { ...runtime, accepted_cursor_at: "2026-10-06T11:00:01.234568Z" },
    ],
    [
      "missing conditional qualification",
      {
        ...runtime,
        conditional_maintenance: {
          numerator: "1273",
          denominator: "100",
          unit: "KRW",
        },
      },
    ],
    [
      "unapproved qualification",
      {
        ...runtime,
        conditional_maintenance: {
          ...runtime.conditional_maintenance,
          qualification: "CONFIRMED",
        },
      },
    ],
    ["allocation over global limit", { ...runtime, allocation_bps: "10001" }],
    ["unsupported runtime version", { ...runtime, runtime_version: 3 }],
  ])(
    "rejects %s rather than showing unsupported money as ready",
    (_label, value) => {
      expect(parseMiningServerDisplay(snapshot(value))).toBeNull();
    },
  );

  it("retains arbitrarily large decimal-string counts without floating point loss", () => {
    const parsed = parseMiningServerDisplay(
      snapshot({
        ...runtime,
        state_revision: "9007199254740993",
        committed_reward_total_atomic: "9007199254740993",
      }),
    );
    expect(parsed?.funded_runtime?.state_revision).toBe("9007199254740993");
    const display = presentMiningServerDisplay(parsed!);
    expect(
      display.state === "ready" &&
        display.rows.find((row) => row.label === "채굴 확정 누계")?.value,
    ).toBe("9,007,199,254,740,993원");
  });
});
