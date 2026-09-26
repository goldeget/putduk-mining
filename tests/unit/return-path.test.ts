import { describe, expect, it } from "vitest";

import {
  buildLoginPath,
  isSafeProtectedReturnPath,
  safeProtectedReturnPath,
} from "@/lib/auth/return-path";

describe("protected return paths", () => {
  it("preserves nested protected routes and their query", () => {
    const path = "/wallet/withdraw?receipt=one";
    expect(isSafeProtectedReturnPath(path)).toBe(true);
    expect(safeProtectedReturnPath(path)).toBe(path);
    expect(buildLoginPath(path)).toBe(
      "/login?next=%2Fwallet%2Fwithdraw%3Freceipt%3Done",
    );
  });

  it.each([
    "https://attacker.invalid/wallet",
    "//attacker.invalid/wallet",
    "/public",
    "/wallet\\redirect",
    "/wallet#javascript:alert(1)",
  ])("rejects an unsafe or public destination: %s", (path) => {
    expect(isSafeProtectedReturnPath(path)).toBe(false);
    expect(safeProtectedReturnPath(path)).toBe("/start");
  });
});
