import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthExperience } from "@/components/auth/auth-experience";
import { TrustShell } from "@/components/layout/trust-shell";
import {
  TRUST_DOCUMENTS,
  getTrustDocument,
} from "@/lib/workroom/public-content";
import { getTrustNavigationLabel } from "@/lib/workroom/public-presentation";
import { LEGAL_DOCUMENTS } from "@/lib/trust/legal-content";
import TrustDocumentPage from "@/app/(trust)/[...document]/page";
vi.mock("next/navigation", () => ({
  usePathname: () => "/privacy",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
describe("WORKROOM public surfaces", () => {
  it.each([
    "/find-id",
    "/recover",
    "/auth/update-password",
    "/auth/error",
    "/auth/forbidden",
  ])(
    "uses the shared WORKROOM frame for %s without a scene or mining illustration",
    (route) => {
      const html = renderToStaticMarkup(
        createElement(
          AuthExperience,
          {
            route,
            titleId: "account-help",
            eyebrow: "계정 도움",
            title: "계정을 확인하세요",
            description: "필요한 계정 절차를 이어가세요.",
            panelTitle: "확인하기",
            panelDescription: "정보를 입력해 주세요.",
          },
          createElement("form", { "aria-label": "실제 폼 위치" }),
        ),
      );
      expect(html).toContain('data-workroom-surface="auth"');
      expect(html).toContain('aria-label="화면 테마"');
      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="/privacy"');
      expect(html).not.toContain("data-auth-scrim");
      expect(html).not.toContain("채굴");
    },
  );
  it("uses the same public frame, complete descriptive navigation, and one main landmark", () => {
    const html = renderToStaticMarkup(
      createElement(
        TrustShell,
        null,
        createElement("article", null, "안내 본문"),
      ),
    );
    expect(html).toContain('data-workroom-surface="public"');
    expect((html.match(/<main\b/g) ?? []).length).toBe(1);
    expect(html).toContain('href="#public-content"');
    const labels = TRUST_DOCUMENTS.map((document) =>
      getTrustNavigationLabel(document.path),
    );
    expect(labels).not.toContain("워크룸 안내");
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("shows current noncash practice facts while retaining original consent metadata and privacy duties", () => {
    const terms = getTrustDocument("/terms")!;
    const privacy = getTrustDocument("/privacy")!;
    for (const original of LEGAL_DOCUMENTS)
      expect(getTrustDocument(original.path)?.consentVersion).toBe(
        original.consentVersion,
      );
    expect(JSON.stringify(terms)).toContain("100,000 P");
    expect(JSON.stringify(terms)).not.toMatch(
      /5,000원|24시간|사용량 100%|채굴/,
    );
    expect(JSON.stringify(privacy)).not.toMatch(/체험 전환|채굴/);
    expect(JSON.stringify(privacy)).toContain(
      "제출한 서류는 확인할 때만 운영자가 열어 봐요. 열어 본 기록이 남아요.",
    );
    expect(JSON.stringify(privacy)).toContain(
      "출금 계좌와 USDT 주소는 암호화해서 보관해요.",
    );
  });
  it("changes only the approved obsolete feature sections in the current consent display", () => {
    for (const original of LEGAL_DOCUMENTS) {
      const current = getTrustDocument(original.path)!;
      expect(current.summary).toBe(original.summary);
      expect(current.title).toBe(original.title);
      const approved =
        original.path === "/terms"
          ? ["WORKROOM 체험", "채굴과 결과", "점검과 이용 제한"]
          : ["본인 확인 서류", "이용 기록"];
      for (const section of original.sections.filter(
        (section) => !approved.includes(section.heading),
      ))
        expect(
          current.sections.find(
            (candidate) => candidate.heading === section.heading,
          ),
        ).toEqual(section);
    }
    expect(JSON.stringify(LEGAL_DOCUMENTS)).toContain("최대 5,000원");
  });
  it("gives the actual privacy reader a linked in-flow contents list and one primary heading", async () => {
    const html = renderToStaticMarkup(
      await TrustDocumentPage({
        params: Promise.resolve({ document: ["privacy"] }),
      }),
    );
    expect(html).toContain('aria-label="문서 목차"');
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    const privacy = getTrustDocument("/privacy")!;
    privacy.sections.forEach((_, index) => {
      expect(html).toContain(`href="#section-${index + 1}"`);
      expect(html).toContain(`id="section-${index + 1}"`);
    });
    expect(html).not.toContain("trust-document__body");
    expect(html).toContain("현재 안내 버전");
    expect(html).toContain("동의 기록 버전");
  });
});
