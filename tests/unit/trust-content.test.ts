import { describe, expect, it } from "vitest";

import {
  getTrustDocument,
  PUBLIC_FACTS,
  START_WELCOME_STATEMENTS,
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
        "/ai/about",
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

  it("states the one-time welcome cap without denying conversion", () => {
    const cap = PUBLIC_FACTS.find((fact) => fact.key === "START_WELCOME_CAP");
    expect(cap?.value).toContain("5,000원");
    for (const statement of START_WELCOME_STATEMENTS) {
      expect(cap?.description).toContain(statement);
    }

    const faq = getTrustDocument("/faq");
    const conversion = faq?.sections.find(
      (section) => section.heading === "체험 결과가 실제 잔액이 되나요?",
    );
    expect(conversion?.body.join(" ")).toContain("5,000원");
    expect(conversion?.body.join(" ")).not.toContain("아닙니다");

    const trial = getTrustDocument("/trial");
    const separation = trial?.sections.find(
      (section) => section.heading === "분리 원칙",
    );
    expect(separation?.body.join(" ")).toContain("자동 전환되거나 섞이지");
    expect(separation?.body.join(" ")).toContain("입금하지 않아도");
  });
});
