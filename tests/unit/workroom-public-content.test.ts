import { describe, expect, it } from "vitest";
import { TRUST_DOCUMENTS as archived } from "@/lib/trust/public-content";
import { PUBLIC_FACTS, TRUST_DOCUMENTS } from "@/lib/workroom/public-content";

describe("current WORKROOM public guidance", () => {
  it("preserves each original legal consent body and version", () => {
    const legal = archived.filter((document) => document.consentVersion);
    expect(legal.length).toBeGreaterThan(0);
    for (const document of legal)
      expect(
        TRUST_DOCUMENTS.find((current) => current.path === document.path),
      ).toBe(document);
  });
  it("replaces historical mining and cash reward promises in active guidance", () => {
    const guidance = TRUST_DOCUMENTS.filter(
      (document) => !document.consentVersion,
    );
    const copy = JSON.stringify(guidance);
    expect(copy).not.toMatch(/채굴|5,000원|PUTDUK MINING/);
    expect(copy).toContain("현금으로 바꿀 수 없어요");
    expect(copy).toContain("사전 설정된 패턴");
    expect(
      PUBLIC_FACTS.find((fact) => fact.key === "PRODUCT_NAME")?.value,
    ).toBe("WORKROOM");
  });
});
