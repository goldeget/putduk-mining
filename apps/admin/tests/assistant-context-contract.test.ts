import { describe, expect, it } from "vitest";
import {
  assistantContextInput,
  assistantContextReport,
  assistantSourceHref,
  contextReportBuilder,
} from "@/lib/assistant/context";

describe("operational explanation contract", () => {
  it.each([
    "https://example.test",
    "javascript:alert(1)",
    "//outside.test",
    "/members?phone=01012345678",
    "/exceptions?sql=delete",
    "/api/v1/admin/withdrawals/command",
  ])("rejects unsafe or unregistered source URL %s", (href) => {
    expect(assistantSourceHref.safeParse(href).success).toBe(false);
  });
  it("accepts actual member and deposit evidence destinations", () => {
    for (const href of [
      "/",
      "/exceptions",
      "/members?id=0d460000-0000-4000-8000-000000000001#evidence-money-sources",
      "/deposits/usdt#usdt-deposit-0d460000-0000-4000-8000-000000000001",
    ])
      expect(assistantSourceHref.safeParse(href).success).toBe(true);
  });
  it("requires four distinct classifications and canExecute false", () => {
    const report = contextReportBuilder(
      "현재 기록",
      new Date("2026-10-06T00:00:00Z"),
    ).finish();
    expect(
      assistantContextReport.safeParse({ ...report, canExecute: true }).success,
    ).toBe(false);
    expect(
      assistantContextReport.safeParse({
        ...report,
        sections: Array(4).fill(report.sections[0]),
      }).success,
    ).toBe(false);
    expect(assistantContextReport.safeParse(report).success).toBe(true);
  });
  it("does not accept authority, commands or arbitrary tables in a case selector", () => {
    expect(
      assistantContextInput.safeParse({
        topic: "deposit-case",
        currency: "USDT",
        recordId: "0d460000-0000-4000-8000-000000000001",
        actor: "operator",
        confirmation: true,
      }).success,
    ).toBe(false);
  });
});
