import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TrustDocumentPage, {
  generateStaticParams,
} from "@/app/(trust)/[...document]/page";
import {
  LEGAL_CONSENT_VERSIONS,
  LEGAL_DOCUMENTS,
} from "@/lib/trust/legal-content";
import { getTrustDocument, TRUST_DOCUMENTS } from "@/lib/trust/public-content";
import { getTrustNavigationLabel } from "@/lib/trust/public-presentation";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function sentences(document: (typeof LEGAL_DOCUMENTS)[number]) {
  const texts: string[] = [document.summary];
  for (const section of document.sections) {
    texts.push(section.heading, ...section.body, ...(section.items ?? []));
  }
  return texts;
}

describe("terms and privacy documents", () => {
  it("are registered as public trust routes from one source", () => {
    expect(LEGAL_DOCUMENTS.map((document) => document.path)).toEqual([
      "/terms",
      "/privacy",
    ]);
    for (const document of LEGAL_DOCUMENTS) {
      expect(getTrustDocument(document.path)).toBe(document);
      expect(getTrustNavigationLabel(document.path)).not.toBe("서비스 안내");
    }
    const params = generateStaticParams().map((item) => item.document.join("/"));
    expect(params).toEqual(expect.arrayContaining(["terms", "privacy"]));
    expect(new Set(TRUST_DOCUMENTS.map((d) => d.path)).size).toBe(
      TRUST_DOCUMENTS.length,
    );
  });

  it("render real Korean text from the registry", async () => {
    for (const document of LEGAL_DOCUMENTS) {
      const html = renderToStaticMarkup(
        await TrustDocumentPage({
          params: Promise.resolve({ document: [document.path.slice(1)] }),
        }),
      );
      expect(html).toContain(document.title);
      expect(html).toContain(document.consentVersion);
      for (const section of document.sections) {
        expect(html).toContain(section.heading);
      }
    }
  });

  it("use the same consent versions as signup and the worker", () => {
    const signup = read("app/signup/actions.ts");
    expect(signup).toContain("LEGAL_CONSENT_VERSIONS.serviceTerms");
    expect(signup).toContain("LEGAL_CONSENT_VERSIONS.privacy");
    const runner = read("workers/runner.mjs");
    expect(runner).toContain(LEGAL_CONSENT_VERSIONS.serviceTerms);
    expect(runner).toContain(LEGAL_CONSENT_VERSIONS.privacy);
  });

  it("are linked from signup and the landing footer", () => {
    const form = read("app/signup/signup-form.tsx");
    expect(form).toContain('href="/terms"');
    expect(form).toContain('href="/privacy"');
    const landing = read("app/page.tsx");
    expect(landing).toContain('href="/terms"');
    expect(landing).toContain('href="/privacy"');
  });

  it("follow the Korean content gate", () => {
    for (const document of LEGAL_DOCUMENTS) {
      for (const text of sentences(document)) {
        // 한 문장은 짧게. 문장 부호 기준으로 나눠 확인한다.
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          expect(sentence.length, sentence).toBeLessThanOrEqual(60);
        }
        // 휴대전화 인증처럼 읽히는 표현과 개발자 용어는 쓰지 않는다.
        expect(text).not.toMatch(/휴대폰 인증|SMS|인증번호|DB|API|ledger|RLS/);
        // 요율과 약속을 만들지 않는다.
        expect(text).not.toMatch(/\d+\s?%\s*(수익|이자|보상)|수수료|보장|확정 수익/);
        // 문단은 한 가지 생각만 담는다.
        expect(text.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("only restate documented product limits", () => {
    const terms = sentences(LEGAL_DOCUMENTS[0]!).join(" ");
    expect(terms).toContain("최대 5,000원");
    expect(terms).toContain("한 번");
    expect(terms).toContain("실제 지갑과 따로");
    expect(terms).toContain("USDT는 따로 보관하지 않아요");
    expect(terms).toContain("원화 잔액");
    // 휴대전화는 가입 가능 여부만 확인한다.
    expect(terms).toContain("소유를 확인하는 인증은 아니에요");
  });
});
