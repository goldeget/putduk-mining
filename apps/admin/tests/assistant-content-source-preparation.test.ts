import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  ASSISTANT_CONTENT_SOURCE_PREPARATIONS,
  findAssistantContentSourcePreparation,
} from "@/lib/assistant/content-source-preparation";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
describe("operator AI source-extractive preparation ports; no new executor", () => {
  it("uses exactly the original30/26/68 source datasets and one existing handler", () => {
    expect(
      ASSISTANT_CONTENT_SOURCE_PREPARATIONS.map((row) => [
        row.kind,
        row.sourceItemCount,
      ]),
    ).toEqual([
      ["EVENT", 30],
      ["NOTICE", 26],
      ["FAQ", 68],
    ]);
    expect(
      new Set(ASSISTANT_CONTENT_SOURCE_PREPARATIONS.map((row) => row.endpoint)),
    ).toEqual(new Set(["/api/content/source/preview"]));
    for (const row of ASSISTANT_CONTENT_SOURCE_PREPARATIONS) {
      expect(row.allowedRoles).toEqual(HIGH_IMPACT_ROLES);
      expect(Object.isFrozen(row.allowedRoles)).toBe(true);
      expect(row.requiredAal).toBe("aal2");
      expect(row.maxBodyBytes).toBe(512 * 1024);
      expect(row.inputFields).toEqual([
        "sourceRevision",
        "sourcePath",
        "sourceSha256",
        "rawSourceText",
      ]);
      expect(row.inputTaskFieldAllowed).toBe(false);
      expect(row.errorContract.unknownPin).toBe(400);
      expect(row.errorContract.sourceHashOrShapeMismatch).toBe(409);
      expect(row.errorContract.payloadTooLarge).toBe(413);
      expect(row.sourceRevision).toBe(
        "ba9ed931f756488ce4f67f945cffad9552842c09",
      );
      expect(row.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("never creates publication, reward or provider authority", () => {
    for (const row of ASSISTANT_CONTENT_SOURCE_PREPARATIONS) {
      expect(row.successState).toBe("DRAFT_ONLY");
      for (const flag of [
        "canPublish",
        "canExecute",
        "providerCalled",
        "registrationExecuted",
        "economicPolicyApproval",
      ] as const)
        expect(row[flag]).toBe(false);
    }
  });
  it("returns null for unknown tasks without widening the source pins", () => {
    expect(findAssistantContentSourcePreparation("publish-event")).toBeNull();
    expect(
      findAssistantContentSourcePreparation("content-source-event-prepare")
        ?.sourcePath,
    ).toBe("events.json");
  });
});
