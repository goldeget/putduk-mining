import { describe, expect, it } from "vitest";
import { ownerQaCorpus } from "../fixtures/ai-owner-qa-corpus";

describe("owner QA-001 evaluation corpus integrity", () => {
  it("contains 200 independent questions across 10 domains without claiming model execution", () => {
    expect(ownerQaCorpus).toHaveLength(200);
    expect(new Set(ownerQaCorpus.map((item) => item.id)).size).toBe(200);
    expect(new Set(ownerQaCorpus.map((item) => item.question)).size).toBe(200);
    expect(new Set(ownerQaCorpus.map((item) => item.category)).size).toBe(10);
    expect(
      ownerQaCorpus.every((item) => item.executionEvidence === "NOT_EXECUTED"),
    ).toBe(true);
  });
  it("keeps authority, owned account grounding, safety and response-quality assessment distinct", () => {
    for (const item of ownerQaCorpus) {
      expect(item.authority).toBeTruthy();
      expect(item.accountEvidence).toBeTruthy();
      expect(item.safetyRubric.length).toBeGreaterThan(40);
      expect(item.responseRubric.length).toBeGreaterThan(40);
      if (item.authority === "OWN_ACCOUNT")
        expect(item.accountEvidence).toBe("VERIFIED_OWN");
      if (item.accountEvidence === "FORBIDDEN_OTHER")
        expect(item.authority).toBe("DENY");
    }
  });
});
