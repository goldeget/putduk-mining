import { describe, expect, it } from "vitest";
import {
  validatePushBindingReceipt,
  validatePushEndpointResult,
  type PushEndpointInput,
} from "@/lib/notifications/push-binding.server";

const session = "11111111-1111-4111-8111-111111111111";
const receipt = "22222222-2222-4222-8222-222222222222";
const subscription = "33333333-3333-4333-8333-333333333333";
describe("durable Push binding receipt", () => {
  it("does not convert null/oldboolean/partial/foreign-operation into success", () => {
    for (const value of [
      null,
      false,
      true,
      {},
      { subscribed: true },
      {
        subscribed: true,
        operation: "REGISTER",
        scope: "CURRENT_SESSION",
        authSessionId: "44444444-4444-4444-8444-444444444444",
        receiptId: receipt,
        subscriptionId: subscription,
      },
      {
        subscribed: true,
        operation: "REGISTER",
        scope: "CURRENT_ENDPOINT",
        authSessionId: session,
        receiptId: receipt,
        subscriptionId: subscription,
      },
      {
        subscribed: true,
        operation: "REGISTER",
        scope: "CURRENT_SESSION",
        authSessionId: session,
        receiptId: receipt,
        subscriptionId: null,
      },
    ])
      expect(
        validatePushBindingReceipt(value, {
          operation: "REGISTER",
          authSessionId: session,
        }),
      ).toBeNull();
  });
  it("validates each exact effect without equating local and global scope", () => {
    const operations = [
      "REGISTER",
      "REVOKE",
      "LOGOUT_LOCAL",
      "LOGOUT_GLOBAL",
    ] as const;
    const scopes = {
      REGISTER: "CURRENT_SESSION",
      REVOKE: "CURRENT_ENDPOINT",
      LOGOUT_LOCAL: "LOCAL",
      LOGOUT_GLOBAL: "GLOBAL",
    };
    for (const operation of operations) {
      const value = {
        subscribed: operation === "REGISTER",
        operation,
        scope: scopes[operation],
        authSessionId: session,
        receiptId: receipt,
        subscriptionId: operation === "REGISTER" ? subscription : null,
      };
      expect(
        validatePushBindingReceipt(value, {
          operation,
          authSessionId: session,
        }),
      ).toEqual(value);
      expect(
        validatePushBindingReceipt(
          { ...value, unexpected: "ignored?" },
          { operation, authSessionId: session },
        ),
      ).toBeNull();
    }
  });
});
describe("Push endpoint epoch receipts", () => {
  const intentId = "55555555-5555-4555-8555-555555555555",
    permitId = "66666666-6666-4666-8666-666666666666";
  const input: PushEndpointInput = {
    operation: "REGISTER",
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
      expirationTime: null,
      keys: { p256dh: "fixture", auth: "fixture" },
    },
    expectedEpoch: 7,
    intentId,
    permitId,
    userAgent: "fixture",
  };
  const value = {
    subscribed: true,
    operation: "REGISTER",
    scope: "CURRENT_SESSION",
    authSessionId: session,
    receiptId: receipt,
    subscriptionId: subscription,
    endpointEpoch: 8,
    intentId,
    permitId,
  };
  it("accepts only the exact next epoch and current intent permit", () => {
    expect(validatePushEndpointResult(value, input, session)).toEqual(value);
    for (const changed of [
      { endpointEpoch: 7 },
      { endpointEpoch: 9 },
      { intentId: receipt },
      { permitId: receipt },
      { authSessionId: receipt },
      { subscriptionId: null },
      { subscribed: false },
      { unexpected: true },
    ])
      expect(
        validatePushEndpointResult({ ...value, ...changed }, input, session),
      ).toBeNull();
  });
  it("does not accept a legacy bool or partial snapshot as reconciliation", () => {
    for (const bad of [
      false,
      null,
      { subscribed: false },
      { operation: "SNAPSHOT", endpointEpoch: 1 },
      {
        operation: "SNAPSHOT",
        endpointEpoch: 1,
        subscribed: false,
        authSessionId: receipt,
      },
    ])
      expect(
        validatePushEndpointResult(
          bad,
          { operation: "SNAPSHOT", endpoint: input.subscription.endpoint },
          session,
        ),
      ).toBeNull();
  });
});
