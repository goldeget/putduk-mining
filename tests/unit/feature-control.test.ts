import { describe, expect, it } from "vitest";

import {
  assignExperimentVariant,
  evaluateFeatureFlag,
} from "@/domain/config/feature-control";

describe("feature flags and experiments", () => {
  it("fails a paused or expired feature flag closed", () => {
    expect(
      evaluateFeatureFlag(
        {
          defaultEnabled: true,
          enabledSegments: [],
          key: "WELCOME_WITHDRAWAL",
          status: "PAUSED",
        },
        { now: new Date("2026-09-27T00:00:00.000Z"), segments: [] },
      ),
    ).toBe(false);
    expect(
      evaluateFeatureFlag(
        {
          defaultEnabled: true,
          enabledSegments: [],
          expiresAt: new Date("2026-09-27T00:00:00.000Z"),
          key: "WELCOME_WITHDRAWAL",
          status: "ACTIVE",
        },
        { now: new Date("2026-09-27T00:00:00.000Z"), segments: [] },
      ),
    ).toBe(false);
  });

  it("assigns a stable non-economic experiment variant", () => {
    const experiment = {
      affectsEconomicTruth: false,
      key: "ONBOARDING_COPY",
      variants: [
        { allocationBps: 5_000, key: "CONTROL" },
        { allocationBps: 5_000, key: "CONCISE" },
      ],
      version: 1,
    };
    const first = assignExperimentVariant(experiment, "member-1");
    expect(assignExperimentVariant(experiment, "member-1")).toBe(first);
  });

  it("forbids experiments from randomizing economic truth", () => {
    expect(() =>
      assignExperimentVariant(
        {
          affectsEconomicTruth: true,
          key: "REWARD_AMOUNT",
          variants: [{ allocationBps: 10_000, key: "A" }],
          version: 1,
        },
        "member-1",
      ),
    ).toThrow(/monetary truth/i);
  });
});
