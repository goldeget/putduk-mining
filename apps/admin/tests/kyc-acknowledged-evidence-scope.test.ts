import { describe, expect, it } from "vitest";
import { acknowledgedSubmissionForCase } from "@/app/(control)/kyc/acknowledged-evidence";
describe("ephemeral acknowledgment selection", () => {
  it("does not carry an ACK across cases or expired receipts", () => {
    const state = {
      caseId: "case-A",
      evidence: {
        submissionId: "submission-A",
        expiresAt: "2026-10-12T01:05:00Z",
      },
    };
    const now = Date.parse("2026-10-12T01:00:00Z");
    expect(acknowledgedSubmissionForCase(state, "case-A", now)).toBe(
      "submission-A",
    );
    expect(acknowledgedSubmissionForCase(state, "case-B", now)).toBeUndefined();
    expect(
      acknowledgedSubmissionForCase(state, "case-A", now + 300_000),
    ).toBeUndefined();
    expect(
      acknowledgedSubmissionForCase(
        { ...state, evidence: { ...state.evidence, expiresAt: "invalid" } },
        "case-A",
        now,
      ),
    ).toBeUndefined();
  });
});
