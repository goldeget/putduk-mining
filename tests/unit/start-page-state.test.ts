import { describe, expect, it } from "vitest";
import { resolveStartPageState } from "@/lib/product/start-page-state";
import { presentNotificationPreferencesRead } from "@/lib/product/notification-preferences-read";

describe("START state truth", () => {
  it("keeps unknown/error copy and actions conservative", () => {
    for (const input of [
      { status: "SETTLING_NEW_STATUS", hasSnapshot: true, readFailed: false },
      { status: null, hasSnapshot: true, readFailed: false },
      { status: "ACTIVE", hasSnapshot: true, readFailed: true },
    ]) {
      const state = resolveStartPageState(input);
      expect(state.uncertain).toBe(true);
      expect(state.active).toBe(false);
      expect(state.ready).toBe(false);
      expect(state.headingTitle).toContain("확인");
      expect(state.commandTitle).toContain("확인");
      expect(state.commandLead).not.toContain("준비가 되면");
    }
  });
  it("only confirmed ACTIVE enables a running scene", () => {
    expect(
      resolveStartPageState({
        status: "ACTIVE",
        hasSnapshot: true,
        readFailed: false,
      }).active,
    ).toBe(true);
    for (const status of ["READY", "COMPLETED", "EXPIRED"]) {
      expect(
        resolveStartPageState({ status, hasSnapshot: true, readFailed: false })
          .active,
      ).toBe(false);
    }
  });
  it("a successful missing snapshot uses the existing not-started contract", () => {
    expect(
      resolveStartPageState({
        status: null,
        hasSnapshot: false,
        readFailed: false,
      }).ready,
    ).toBe(true);
  });
});

describe("notification preferences read", () => {
  const original = {
    events_enabled: false,
    marketing_enabled: false,
    mining_enabled: true,
    service_enabled: true,
    wallet_enabled: false,
  };
  it("never defaults unread original preferences", () => {
    expect(
      presentNotificationPreferencesRead(original, { message: "network" }),
    ).toEqual({ state: "error", preferences: null });
    expect(
      presentNotificationPreferencesRead({ mining_enabled: true }, null).state,
    ).toBe("error");
  });
  it("distinguishes genuine absence from a valid saved false value", () => {
    expect(presentNotificationPreferencesRead(null, null)).toEqual({
      state: "empty",
      preferences: null,
    });
    expect(presentNotificationPreferencesRead(original, null)).toEqual({
      state: "loaded",
      preferences: original,
    });
  });
});
