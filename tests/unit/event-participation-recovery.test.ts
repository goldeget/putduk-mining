import { describe, expect, it } from "vitest";
import {
  canJoinMemberEvent,
  eventParticipationInputSchema,
  eventParticipationReceiptSchema,
  hasEventCommandOrigin,
  memberEventContentSchema,
  memberEventAwardSchema,
} from "@/domain/events/participation";
import { buildRecoveryEventPayloads } from "../e2e/authenticated/helpers/recovery-event-registry";
import { eventContentSchema } from "@/domain/content/contract";
const id = "11111111-1111-4111-8111-111111111111";
describe("event participation recovery", () => {
  it("projects only nonfinancial own-award display fields", () => {
    const award = {
      id,
      event_id: id,
      reward_kind: "BADGE",
      title_ko: "첫 여정",
      created_at: "2026-10-09T01:00:00Z",
    };
    expect(memberEventAwardSchema.safeParse(award).success).toBe(true);
    for (const patch of [
      { qualification: {} },
      { source_digest: "a".repeat(64) },
      { reward_kind: "CASH_REWARD" },
      { title_ko: "" },
    ])
      expect(
        memberEventAwardSchema.safeParse({ ...award, ...patch }).success,
      ).toBe(false);
  });
  it("accepts no client user, money, mission counters or claimed eligibility", () => {
    const input = { eventId: id, revisionId: id, idempotencyKey: id };
    expect(eventParticipationInputSchema.safeParse(input).success).toBe(true);
    for (const patch of [
      { userId: id },
      { amount: 5000 },
      { qualified: true },
      { progress: 100 },
      { idempotencyKey: "same" },
    ])
      expect(
        eventParticipationInputSchema.safeParse({ ...input, ...patch }).success,
      ).toBe(false);
  });
  it("checks start-inclusive/end-exclusive live schedule and invalid timestamps", () => {
    const start = "2026-10-09T00:00:00Z",
      end = "2026-10-10T00:00:00Z";
    expect(canJoinMemberEvent("SCHEDULED", start, end, start)).toBe(true);
    expect(canJoinMemberEvent("LIVE", start, end, end)).toBe(false);
    for (const status of ["DRAFT", "CANCELLED", "ENDED"])
      expect(canJoinMemberEvent(status, start, end, start)).toBe(false);
    expect(canJoinMemberEvent("LIVE", "broken", end, start)).toBe(false);
  });
  it("rejects cross-site, missing and prefix-spoofed origins", () => {
    const make = (origin?: string, site?: string) =>
      new Request("http://127.0.0.1:61441/api/v1/events/participation", {
        headers: {
          ...(origin ? { origin } : {}),
          ...(site ? { "sec-fetch-site": site } : {}),
        },
      });
    expect(hasEventCommandOrigin(make("http://127.0.0.1:61441"))).toBe(true);
    for (const req of [
      make(),
      make("http://127.0.0.1:61441.evil.invalid"),
      make("http://127.0.0.1:61441", "cross-site"),
    ])
      expect(hasEventCommandOrigin(req)).toBe(false);
  });
  it("fails closed for private/financial projection and incomplete receipts", () => {
    const content = {
      event_id: id,
      revision_id: id,
      body_ko: "본문",
      participation_ko: "참여 조건",
      exclusion_ko: "유의 사항",
      cta_label: "안내 보기",
      cta_route: "/events",
      reward_mode: "NONE",
    };
    expect(memberEventContentSchema.safeParse(content).success).toBe(true);
    expect(
      memberEventContentSchema.safeParse({
        ...content,
        cta_route: "//evil.invalid",
      }).success,
    ).toBe(false);
    expect(
      memberEventContentSchema.safeParse({
        ...content,
        reward_mode: "CASH_REWARD",
      }).success,
    ).toBe(false);
    expect(
      eventParticipationReceiptSchema.safeParse({ eventId: id }).success,
    ).toBe(false);
  });
  it("keeps twenty distinct approved-template drafts explicitly local, without financial promises", () => {
    const drafts = buildRecoveryEventPayloads(
      "qa-owned-run",
      "2026-10-09T00:00:00Z",
      "2026-10-10T00:00:00Z",
    );
    expect(drafts).toHaveLength(20);
    expect(new Set(drafts.map((d) => d.slug)).size).toBe(20);
    expect(new Set(drafts.map((d) => d.title)).size).toBe(20);
    for (const draft of drafts) {
      expect(eventContentSchema.safeParse(draft).success).toBe(true);
      expect(draft.body).toContain("현금 보상과 운영 혜택이 없습니다");
    }
    expect(() => buildRecoveryEventPayloads("production", "x", "y")).toThrow();
  });
});
