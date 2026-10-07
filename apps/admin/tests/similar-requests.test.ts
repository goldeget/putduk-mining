import { describe, expect, it } from "vitest";
import { similarPendingRequests } from "@/lib/operations/similar-requests";

describe("pending similarity is a presentation hint, not automatic rejection", () => {
  const request = {
    id: "one",
    userId: "member",
    method: "KRW",
    amount: "5000",
  };
  it("matches exact amounts without floating point and counts distinct requests", () => {
    const result = similarPendingRequests([
      request,
      { ...request, id: "two", amount: "5000.00" },
      request,
    ]);
    expect(result.get("one")).toBe(2);
    expect(result.get("two")).toBe(2);
  });
  it("does not group different members, networks or values", () => {
    const result = similarPendingRequests([
      request,
      { ...request, id: "two", userId: "other" },
      { ...request, id: "three", method: "USDT" },
      { ...request, id: "four", amount: "5001" },
    ]);
    expect(result.size).toBe(0);
  });
  it("does not guess unsafe numeric or malformed amount equality", () => {
    expect(
      similarPendingRequests([
        { ...request, amount: 9_007_199_254_740_992 },
        { ...request, id: "two", amount: "9e15" },
      ]).size,
    ).toBe(0);
  });
});
