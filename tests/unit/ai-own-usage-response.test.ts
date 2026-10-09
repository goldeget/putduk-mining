import { describe, expect, it } from "vitest";
import { apiSuccess } from "@/lib/api/http";
import { readOwnUsageResponse } from "@/lib/ai/read-own-usage-response";

const ownerId = "own-member";
const usage = {
  ownerId,
  observedAt: "2026-10-09T01:00:00Z",
  rolling24h: { used: 0, limit: 100, nextAvailableAt: null },
  rollingMinute: { used: 5, limit: 5, nextAvailableAt: "2026-10-09T01:00:20Z" },
  providerAttempts: { nvidia: { inputTokens: null, outputTokens: null } },
};

describe("own usage API response contract", () => {
  it("accepts the actual apiSuccess response without losing measured zero or the expiry", async () => {
    const response = apiSuccess(usage);
    expect(readOwnUsageResponse(await response.json(), ownerId)).toEqual(usage);
  });
  it("rejects another member and the obsolete unwrapped mock response", () => {
    expect(
      readOwnUsageResponse({ data: usage }, "different-member"),
    ).toBeNull();
    expect(readOwnUsageResponse(usage, ownerId)).toBeNull();
  });
  it.each([
    null,
    {},
    { error: { code: "AI_USAGE_UNAVAILABLE" } },
    { data: null },
  ])("never substitutes missing reads with zero: %j", (response) =>
    expect(readOwnUsageResponse(response, ownerId)).toBeNull(),
  );
  it.each([
    { ...usage, observedAt: "not-a-date" },
    { ...usage, rolling24h: { ...usage.rolling24h, used: -1 } },
    { ...usage, rollingMinute: { ...usage.rollingMinute, limit: 0 } },
    {
      ...usage,
      rollingMinute: { ...usage.rollingMinute, nextAvailableAt: "invalid" },
    },
  ])("rejects invalid quota values and dates", (data) => {
    expect(readOwnUsageResponse({ data }, ownerId)).toBeNull();
  });
});
