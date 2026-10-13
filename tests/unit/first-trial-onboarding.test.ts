import { describe, expect, it } from "vitest";
import { isFirstTrialOnboardingEligible } from "@/lib/product/first-trial-onboarding";

type Input = Parameters<typeof isFirstTrialOnboardingEligible>[0];
const ownerId = "ab125100-0000-4000-8000-000000000001";
function firstVisit(): Input {
  return {
    ownerId,
    trial: { user_id: ownerId, status: "READY", completed_at: null },
    conversion: null,
    lifecycle: {
      user_id: ownerId,
      stage: "SIGNED_UP",
      first_funding_at: null,
      welcome_withdrawal_completed_at: null,
    },
    trialReadFailed: false,
    conversionReadFailed: false,
    lifecycleReadFailed: false,
  };
}

describe("server-owned first trial guidance eligibility", () => {
  it("allows confirmed first READY and the existing successful not-started read", () => {
    expect(isFirstTrialOnboardingEligible(firstVisit())).toBe(true);
    expect(
      isFirstTrialOnboardingEligible({ ...firstVisit(), trial: null }),
    ).toBe(true);
  });
  it.each(["SIGNED_UP", "TRIAL_STARTED", "FIRST_MINING"])(
    "allows first ACTIVE with %s lifecycle",
    (stage) => {
      const input = firstVisit();
      input.trial!.status = "ACTIVE";
      input.lifecycle!.stage = stage;
      expect(isFirstTrialOnboardingEligible(input)).toBe(true);
    },
  );
  it.each(["COMPLETED", "EXPIRED", "UNKNOWN", "SETTLING", ""])(
    "never offers first guidance for %s trial, regardless of local preferences",
    (status) => {
      const input = firstVisit();
      input.trial!.status = status;
      expect(isFirstTrialOnboardingEligible(input)).toBe(false);
    },
  );
  it("rejects a canonical completion receipt even if current status appears ACTIVE", () => {
    const input = firstVisit();
    input.trial!.status = "ACTIVE";
    input.trial!.completed_at = "2026-10-13T00:00:00Z";
    expect(isFirstTrialOnboardingEligible(input)).toBe(false);
  });
  it.each([
    "PENDING_QUALIFICATION",
    "QUALIFIED",
    "AUTO_HOLD",
    "APPROVED",
    "CONVERTED",
    "REJECTED",
    "REVERSED",
    "FUTURE_STATUS",
  ])("blocks any existing conversion history: %s", (status) => {
    expect(
      isFirstTrialOnboardingEligible({
        ...firstVisit(),
        conversion: { user_id: ownerId, status },
      }),
    ).toBe(false);
  });
  it.each([
    "TRIAL_COMPLETED",
    "FIRST_WELCOME_WITHDRAWAL",
    "WITHDRAWAL_COMPLETED_NO_FUNDING",
    "FIRST_FUNDING",
    "FIRST_REAL_MINING",
    "ACTIVE_7D",
    "ACTIVE_30D",
    "LONG_TERM_ACTIVE",
    "VISITOR",
    "FUTURE_STAGE",
  ])(
    "blocks advanced or unknown lifecycle %s even without a trial snapshot",
    (stage) => {
      const input = firstVisit();
      input.lifecycle!.stage = stage;
      input.trial = null;
      expect(isFirstTrialOnboardingEligible(input)).toBe(false);
    },
  );
  it.each([
    "trialReadFailed",
    "conversionReadFailed",
    "lifecycleReadFailed",
  ] as const)(
    "fails closed during %s, then recovers only from complete server reads",
    (field) => {
      const input = firstVisit();
      input[field] = true;
      expect(isFirstTrialOnboardingEligible(input)).toBe(false);
      input[field] = false;
      expect(isFirstTrialOnboardingEligible(input)).toBe(true);
      input.trial!.status = "COMPLETED";
      expect(isFirstTrialOnboardingEligible(input)).toBe(false);
    },
  );
  it("requires a present, owned lifecycle and owned trial on account switches", () => {
    expect(
      isFirstTrialOnboardingEligible({ ...firstVisit(), lifecycle: null }),
    ).toBe(false);
    expect(
      isFirstTrialOnboardingEligible({
        ...firstVisit(),
        ownerId: "another-owner",
      }),
    ).toBe(false);
    const input = firstVisit();
    input.trial!.user_id = "another-owner";
    expect(isFirstTrialOnboardingEligible(input)).toBe(false);
  });
  it.each(["first_funding_at", "welcome_withdrawal_completed_at"] as const)(
    "blocks historical %s even if lifecycle stage regresses",
    (field) => {
      const input = firstVisit();
      input.lifecycle![field] = "2026-10-13T00:00:00Z";
      expect(isFirstTrialOnboardingEligible(input)).toBe(false);
    },
  );
});
