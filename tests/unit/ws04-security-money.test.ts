import { describe, expect, it } from "vitest";

import {
  isSignupPhoneAvailability,
  normalizeSignupPhone,
} from "@/domain/identity/signup-phone";
import {
  canFinalizeWithdrawalLedger,
  canReleaseWithdrawalHold,
  shouldRetryExternalSend,
} from "@/domain/wallet/withdrawal-lifecycle";

describe("signup phone normalization", () => {
  it("normalizes Korea local numbers to E.164", () => {
    expect(normalizeSignupPhone("010-1234-5678")).toBe("+821012345678");
  });

  it("rejects invalid input", () => {
    expect(normalizeSignupPhone("abc")).toBeNull();
  });

  it("only allows AVAILABLE or UNAVAILABLE result shapes", () => {
    expect(isSignupPhoneAvailability("AVAILABLE")).toBe(true);
    expect(isSignupPhoneAvailability("UNAVAILABLE")).toBe(true);
    expect(isSignupPhoneAvailability("USER_EXISTS")).toBe(false);
  });
});

describe("withdrawal lifecycle guards", () => {
  it("blocks release after external send", () => {
    expect(canReleaseWithdrawalHold("EXTERNAL_SENT_RECORDED")).toBe(false);
    expect(canReleaseWithdrawalHold("HELD")).toBe(true);
  });

  it("finalizes only after external send and never retries send", () => {
    expect(canFinalizeWithdrawalLedger("EXTERNAL_SENT_RECORDED")).toBe(true);
    expect(shouldRetryExternalSend("EXTERNAL_SENT_RECORDED")).toBe(false);
  });
});
