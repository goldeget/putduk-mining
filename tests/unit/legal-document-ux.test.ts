/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TrustDocumentPage from "@/app/(trust)/[...document]/page";
import { LEGAL_DOCUMENTS } from "@/lib/trust/legal-content";

describe("legal documents remain readable without changing their terms", () => {
  it.each(LEGAL_DOCUMENTS)(
    "$path gives the confirmed public contact without inventing operator details",
    async (legalDocument) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        await TrustDocumentPage({
          params: Promise.resolve({ document: [legalDocument.path.slice(1)] }),
        }),
      );
      const contact = host.querySelector<HTMLAnchorElement>(
        'a[href="mailto:help@putduk.com"]',
      );
      expect(contact?.textContent).toBe("help@putduk.com");
      const contactSection = host.querySelector("#legal-section-10");
      expect(contactSection?.textContent).toContain("퍼뜩 채굴");
      expect(contactSection?.textContent).toContain(
        legalDocument.path === "/privacy" ? "개인정보 문의" : "서비스 문의",
      );
      expect(contactSection?.textContent).toContain("help@putduk.com");
      expect(host.textContent).not.toMatch(
        /사업자등록번호|해외 법인|해외 사업자/,
      );
      expect(contactSection?.textContent).not.toMatch(
        /24시간|답변 보장|영업일/,
      );
    },
  );

  it.each(LEGAL_DOCUMENTS)(
    "$path offers a complete linked contents list and unchanged full text",
    async (legalDocument) => {
      const element = await TrustDocumentPage({
        params: Promise.resolve({ document: [legalDocument.path.slice(1)] }),
      });
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(element);
      expect(host.querySelectorAll("h1")).toHaveLength(1);
      expect(host.querySelector("h1")?.textContent).toBe(legalDocument.title);
      const contents = host.querySelector(
        `nav[aria-label="${legalDocument.title} 목차"]`,
      );
      expect(contents).not.toBeNull();
      const links = contents!.querySelectorAll<HTMLAnchorElement>("a");
      expect(links).toHaveLength(legalDocument.sections.length);
      legalDocument.sections.forEach((section, index) => {
        const target = host.querySelector(links[index]!.getAttribute("href")!);
        expect(target?.querySelector("h2")?.textContent).toBe(section.heading);
        for (const text of [...section.body, ...(section.items ?? [])]) {
          expect(target?.textContent).toContain(text);
        }
      });
      expect(host.textContent).toContain("전문을 대체하지 않는 핵심 안내");
      expect(host.querySelector("[data-legal-full-text]")).not.toBeNull();
      expect(host.textContent).toContain(legalDocument.consentVersion);
      expect(host.textContent).not.toContain("안내 원칙");
      expect(host.textContent).not.toContain("최근 수정일");
    },
  );

  it("keeps the existing general renderer for a non-legal trust document", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      await TrustDocumentPage({
        params: Promise.resolve({ document: ["verification"] }),
      }),
    );
    expect(host.textContent).toContain("안내 원칙");
    expect(host.querySelector("[data-legal-full-text]")).toBeNull();
  });
});
