import { describe, expect, it } from "vitest";
import {
  emptyMiningServerDisplay,
  fundedRuntimeDisplaySchema,
  parseMiningServerDisplay,
} from "@/lib/product/mining-server-display";

const stopped = {
  schema_version: 2,
  runtime_version: 2,
  state_revision: "3",
  condition_revision: "3",
  accepted_cursor_at: "2026-10-09T12:00:00.000001Z",
  evaluated_at: "2026-10-09T12:00:00.000002Z",
  allocation_bps: "0",
  committed_reward_total_atomic: "7",
  reward_carry: { numerator: "1", denominator: "2", unit: "KRW" },
  conditional_maintenance: {
    numerator: "3",
    denominator: "2",
    unit: "KRW",
    qualification: "UNCONFIRMED",
  },
  status: "STOPPED",
  stop_reason: "FUNDING_BELOW_MINIMUM",
  speed: {
    product_multiplier_bps: "10000",
    user_multiplier_bps: "10000",
    common_multiplier: { numerator: "1", denominator: "1" },
    effective_global_multiplier: { numerator: "0", denominator: "1" },
  },
};
const display = {
  ...emptyMiningServerDisplay,
  available: true,
  tier_activated: false,
  tier_code: null,
  funded_runtime: stopped,
};
describe("below-minimum server contract", () => {
  it("preserves the truthful stopped DTO and previous reward/carry facts", () => {
    expect(parseMiningServerDisplay(display)?.funded_runtime).toEqual(stopped);
  });
  it.each([
    ["active", { ...stopped, status: "ACTIVE" }],
    ["positive allocation", { ...stopped, allocation_bps: "2000" }],
    [
      "positive effective speed",
      {
        ...stopped,
        speed: {
          ...stopped.speed,
          effective_global_multiplier: { numerator: "1", denominator: "5" },
        },
      },
    ],
  ])("rejects contradictory %s", (_, runtime) => {
    expect(fundedRuntimeDisplaySchema.safeParse(runtime).success).toBe(false);
  });
  it.each([
    ["active Tier", { ...display, tier_activated: true }],
    ["named Tier", { ...display, tier_code: "L1" }],
  ])("rejects contradictory outer %s", (_, value) => {
    expect(parseMiningServerDisplay(value)).toBeNull();
  });
});
