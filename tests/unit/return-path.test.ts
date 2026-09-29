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
    "/home",
    "/notifications",
    "/ai?question=wallet",
    "/events",
    "/events/live-sample",
  ])(
    "preserves a product return path: %s",
    (path) => expect(safeProtectedReturnPath(path)).toBe(path),
  );

  it.each(["/ai/about", "/ai/facts", "/ai/faq", "/ai/how-it-works"])(
    "keeps a public AI trust route outside the protected app boundary: %s",
    (path) => expect(isSafeProtectedReturnPath(path)).toBe(false),
  );

  it.each([
    "https://attacker.invalid/wallet",
    "//attacker.invalid/wallet",
    "/public",
    "/admin",
    "/administrator",
    "/manage",
    "/backoffice",
    "/wallet\\redirect",
    "/wallet#javascript:alert(1)",
  ])("rejects an unsafe or public destination: %s", (path) => {
    expect(isSafeProtectedReturnPath(path)).toBe(false);
    expect(safeProtectedReturnPath(path)).toBe("/home");
  });
});
