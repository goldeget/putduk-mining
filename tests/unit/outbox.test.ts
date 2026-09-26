import { describe, expect, it } from "vitest";

import {
  createDomainEvent,
  shouldApplyBusinessEffect,
  shouldDeliverEvent,
} from "@/domain/events/outbox";

describe("domain event outbox rules", () => {
  it("requires an explicit event version", () => {
    expect(() =>
      createDomainEvent({
        aggregate: { id: "trial-1", type: "TRIAL" },
        correlationId: "corr-1",
        eventId: "event-1",
        eventName: "TRIAL_REWARD_CONVERTED" as "TRIAL_REWARD_CONVERTED.v1",
        idempotencyKey: "trial-1:converted",
        occurredAt: "2026-09-27T00:00:00.000Z",
        payload: { amountKrw: 5_000 },
      }),
    ).toThrow(/versioned/i);
  });

  it("suppresses delivery when a consumer already succeeded", () => {
    expect(
      shouldDeliverEvent("event-1", "notifications", [
        {
          consumer: "notifications",
          eventId: "event-1",
          status: "SUCCEEDED",
        },
      ]),
    ).toBe(false);
  });

  it("allows an explicitly failed delivery to retry", () => {
    expect(
      shouldDeliverEvent("event-1", "notifications", [
        {
          consumer: "notifications",
          eventId: "event-1",
          status: "FAILED",
        },
      ]),
    ).toBe(true);
  });

  it("does not reapply money when a failed consumer retries", () => {
    const effectKey = "referral-reward:qualification-1";
    expect(shouldApplyBusinessEffect(effectKey, new Set())).toBe(true);
    expect(shouldApplyBusinessEffect(effectKey, new Set([effectKey]))).toBe(
      false,
    );
  });
});
