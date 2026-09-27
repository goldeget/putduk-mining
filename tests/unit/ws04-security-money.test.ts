import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isSignupPhoneAvailability,
  normalizeSignupPhone,
} from "@/domain/identity/signup-phone";
import {
  canFinalizeWithdrawalLedger,
  canReleaseWithdrawalHold,
  isWithdrawalReleaseDisposition,
  resolveReleaseDisposition,
  shouldRetryExternalSend,
} from "@/domain/wallet/withdrawal-lifecycle";
import {
  LEGACY_WITHDRAWAL_SUBMIT_URL,
  WITHDRAWAL_DESTINATION_REGISTER_URL,
  WITHDRAWAL_HOLD_SUBMIT_URL,
} from "@/components/product/withdrawal-form";

const root = resolve(import.meta.dirname, "../..");

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

  it("keeps REJECTED and CANCELLED dispositions distinct", () => {
    expect(resolveReleaseDisposition("reject")).toBe("REJECTED");
    expect(resolveReleaseDisposition("cancel")).toBe("CANCELLED");
    expect(isWithdrawalReleaseDisposition("REJECTED")).toBe(true);
    expect(isWithdrawalReleaseDisposition("CANCELLED")).toBe(true);
    expect(isWithdrawalReleaseDisposition("RELEASED")).toBe(false);
  });
});

describe("user withdrawal hold submit path", () => {
  it("posts hold route and never the legacy withdrawals money path", () => {
    const formSource = readFileSync(
      join(root, "components/product/withdrawal-form.tsx"),
      "utf8",
    );

    expect(WITHDRAWAL_HOLD_SUBMIT_URL).toBe("/api/v1/withdrawals/hold");
    expect(WITHDRAWAL_DESTINATION_REGISTER_URL).toBe(
      "/api/v1/withdrawals/destinations",
    );
    expect(LEGACY_WITHDRAWAL_SUBMIT_URL).toBe("/api/v1/withdrawals");

    expect(formSource).toContain("WITHDRAWAL_HOLD_SUBMIT_URL");
    expect(formSource).toContain('"/api/v1/withdrawals/hold"');
    expect(formSource).toContain('"/api/v1/withdrawals/destinations"');
    expect(formSource).not.toMatch(
      /fetch\(\s*["'`]\/api\/v1\/withdrawals["'`]/,
    );
    expect(formSource).not.toMatch(/fetch\(\s*LEGACY_WITHDRAWAL_SUBMIT_URL/);

    const holdRoute = readFileSync(
      join(root, "app/api/v1/withdrawals/hold/route.ts"),
      "utf8",
    );
    expect(holdRoute).toContain("request_krw_withdrawal");
    expect(holdRoute).toContain("request_usdt_withdrawal");
    expect(holdRoute).not.toContain("create_withdrawal_request");
  });
});
