import { describe, expect, it } from "vitest";

import {
  getTrustDocument,
  PUBLIC_FACTS,
  TRUST_DOCUMENTS,
} from "@/lib/trust/public-content";

describe("public trust registry", () => {
  it("contains every specified public discovery route exactly once", () => {
    const paths = TRUST_DOCUMENTS.map((document) => document.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/about",
        "/how-it-works",
        "/putduk-facts",
        "/verification",
        "/mining-rules",
        "/trial",
        "/economy",
        "/deposit",
        "/withdrawal",
        "/faq",
        "/status",
        "/changelog",
        "/ai",
        "/ai/facts",
        "/ai/faq",
        "/ai/how-it-works",
      ]),
    );
  });

  it("keeps fact keys unique and resolvable", () => {
    const keys = PUBLIC_FACTS.map((fact) => fact.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const document of TRUST_DOCUMENTS) {
      for (const key of document.factKeys ?? []) {
        expect(keys).toContain(key);
      }
    }
  });

  it("does not resolve an undocumented public path", () => {
    expect(getTrustDocument("/not-a-putduk-route")).toBeUndefined();
  });
});
