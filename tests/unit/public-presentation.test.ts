import { describe, expect, it } from "vitest";

import { PUBLIC_FACTS, TRUST_DOCUMENTS } from "@/lib/trust/public-content";
import {
  getPublicFactDisplayValue,
  getPublicFactLabel,
  getTrustNavigationLabel,
  localizePublicWorldNames,
} from "@/lib/trust/public-presentation";

describe("public Korean presentation", () => {
  it("labels every governed fact and document without exposing machine keys or paths", () => {
    for (const fact of PUBLIC_FACTS) {
      const label = getPublicFactLabel(fact.key);
      expect(label).not.toBe("서비스 정보");
      expect(label).not.toBe(fact.key);
    }
    const labels = TRUST_DOCUMENTS.map((document) =>
      getTrustNavigationLabel(document.path),
    );
    expect(labels).not.toContain("서비스 안내");
    expect(new Set(labels).size).toBe(TRUST_DOCUMENTS.length);
    expect(labels.some((label) => label.startsWith("/"))).toBe(false);
  });

  it("localizes display text without changing governed facts or currency and brand identifiers", () => {
    const originalFacts = structuredClone(PUBLIC_FACTS);
    const originalDocuments = structuredClone(TRUST_DOCUMENTS);
    for (const fact of PUBLIC_FACTS) {
      getPublicFactDisplayValue(fact);
      getPublicFactLabel(fact.key);
    }
    expect(PUBLIC_FACTS).toEqual(originalFacts);
    expect(TRUST_DOCUMENTS).toEqual(originalDocuments);
    expect(
      localizePublicWorldNames(
        "KOREA에서 USA, GOLD, SILVER, CRYPTO / KRW, USDT, PUTDUK START",
      ),
    ).toBe("한국에서 미국, 금, 은, 디지털 자산 / KRW, USDT, PUTDUK START");
    expect(
      getPublicFactDisplayValue({
        key: "OFFICIAL_DOMAIN",
        value: "mining.putduk.com",
        description: "",
      }),
    ).toBe("mining.putduk.com");
  });
});
