import { describe, expect, it } from "vitest";

import {
  formatAtomicAmount,
  parseDisplayAmount,
} from "@/domain/wallet/format-amount";

describe("formatAtomicAmount", () => {
  it("formats KRW without losing bigint precision", () => {
    expect(formatAtomicAmount("9007199254740993", "KRW")).toBe(
      "9,007,199,254,740,993 KRW",
    );
  });

  it("formats USDT from six decimal atomic units", () => {
    expect(formatAtomicAmount("1234500", "USDT")).toBe("1.2345 USDT");
  });

  it("rejects floating-point input", () => {
    expect(() => formatAtomicAmount("1.25", "KRW")).toThrow(TypeError);
  });

  it("parses display values without floating-point arithmetic", () => {
    expect(parseDisplayAmount("12000", "KRW")).toBe("12000");
    expect(parseDisplayAmount("1.2345", "USDT")).toBe("1234500");
  });

  it("rejects unsupported precision and zero deposits", () => {
    expect(() => parseDisplayAmount("1.0000001", "USDT")).toThrow(TypeError);
    expect(() => parseDisplayAmount("0", "KRW")).toThrow(RangeError);
  });
});
