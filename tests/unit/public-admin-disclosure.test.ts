import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GET as getPublicFactsResponse } from "@/app/api/v1/public/facts/route";
import { GET as getDiscoveryResponse } from "@/app/llms.txt/route";
import { PublicHelpDocument } from "@/app/(trust)/[...document]/public-help-document";
import TrustDocumentPage from "@/app/(trust)/[...document]/page";
import { getCanonicalAiKnowledge } from "@/lib/ai/knowledge";
import {
  getPublicFacts,
  getTrustDocument,
  PUBLIC_FACTS,
  TRUST_DOCUMENTS,
} from "@/lib/trust/public-content";
import { getPublicFactLabel } from "@/lib/trust/public-presentation";

const privateHostname = "admin.mining.putduk.com";

describe("final owner public admin-address and internal-version boundary", () => {
  it("replaces the internal address with member support in the public fact registry", () => {
    expect(JSON.stringify(PUBLIC_FACTS)).not.toContain(privateHostname);
    expect(PUBLIC_FACTS.some((fact) => fact.key === "ADMIN_DOMAIN")).toBe(
      false,
    );
    const support = PUBLIC_FACTS.find(
      (fact) => fact.key === "MEMBER_SUPPORT_PATH",
    );
    expect(support?.value).toBe("/support");
    expect(getPublicFactLabel("MEMBER_SUPPORT_PATH")).toBe("고객지원");
  });

  it("keeps the actual public facts response free of the internal address", async () => {
    const response = getPublicFactsResponse();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain(privateHostname);
    expect(payload.data.facts).toEqual(PUBLIC_FACTS);
    expect(payload.data.facts).toContainEqual(
      expect.objectContaining({
        key: "MEMBER_SUPPORT_PATH",
        value: "/support",
      }),
    );
  });

  it("does not disclose the internal address through public discovery text", async () => {
    const response = getDiscoveryResponse();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(privateHostname);
    expect(body).not.toContain("ADMIN_DOMAIN");
    expect(body).toContain("mining.putduk.com/api/v1/public/facts");
  });

  it("excludes the internal address from both default and requested AI knowledge", () => {
    expect(JSON.stringify(getCanonicalAiKnowledge())).not.toContain(
      privateHostname,
    );
    expect(getCanonicalAiKnowledge(["ADMIN_DOMAIN"]).facts).toEqual([]);
    expect(getCanonicalAiKnowledge(["MEMBER_SUPPORT_PATH"]).facts).toEqual([
      expect.objectContaining({ value: "/support" }),
    ]);
  });

  it("renders the official facts card as member support without the hostname", () => {
    const document = getTrustDocument("/putduk-facts")!;
    const html = renderToStaticMarkup(
      createElement(PublicHelpDocument, {
        document,
        facts: getPublicFacts(document.factKeys),
        path: document.path,
        structuredData: [],
      }),
    );
    expect(html).not.toContain(privateHostname);
    expect(html).not.toContain("운영자 서비스 주소");
    expect(html).toContain("고객지원");
    expect(html).toContain("/support");
  });

  it("removes internal V1 release names from all rendered public help documents", () => {
    for (const document of TRUST_DOCUMENTS) {
      const html = renderToStaticMarkup(
        createElement(PublicHelpDocument, {
          document,
          facts: getPublicFacts(document.factKeys),
          path: document.path,
          structuredData: [],
        }),
      );
      expect(html, document.path).not.toMatch(/\bV1\b/);
    }
  });

  it("renders the actual trust route branches without admin-address or internal-release copy", async () => {
    for (const document of TRUST_DOCUMENTS) {
      const element = await TrustDocumentPage({
        params: Promise.resolve({
          document: document.path.slice(1).split("/"),
        }),
      });
      const html = renderToStaticMarkup(element);
      expect(html, document.path).not.toContain(privateHostname);
      expect(html, document.path).not.toMatch(/\bV1\b/);
      if (document.path === "/putduk-facts") {
        expect(html).toContain("고객지원");
        expect(html).toContain("/support");
        expect(html).not.toContain("운영자 서비스 주소");
      }
    }
  });
});
