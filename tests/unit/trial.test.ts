import { describe, expect, it } from "vitest";

import {
  MAX_TRIAL_DURATION_MS,
  evaluateTrial,
} from "@/domain/trial/evaluate-trial";

const startedAt = new Date("2026-09-26T00:00:00.000Z");

describe("evaluateTrial", () => {
  it("completes at exactly 24 hours using supplied server time", () => {
    const result = evaluateTrial({
      durationMilliseconds: MAX_TRIAL_DURATION_MS,
      quotaConsumedBps: 8_200,
      serverNow: new Date("2026-09-27T00:00:00.000Z"),
      startedAt,
    });

    expect(result).toMatchObject({
      completionReason: "TIME",
      isComplete: true,
      remainingMilliseconds: 0,
      status: "COMPLETED",
    });
  });

  it("completes immediately when quota reaches 100 percent", () => {
    const result = evaluateTrial({
      durationMilliseconds: MAX_TRIAL_DURATION_MS,
      quotaConsumedBps: 10_000,
      serverNow: new Date("2026-09-26T00:08:00.000Z"),
      startedAt,
    });

    expect(result.completionReason).toBe("QUOTA");
    expect(result.isComplete).toBe(true);
  });

  it("rejects client-like time before the server-issued start", () => {
    expect(() =>
      evaluateTrial({
        durationMilliseconds: MAX_TRIAL_DURATION_MS,
        quotaConsumedBps: 0,
        serverNow: new Date("2026-09-25T23:59:59.999Z"),
        startedAt,
      }),
    ).toThrow(/server time/i);
  });
});
