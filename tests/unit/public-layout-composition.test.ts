import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const home = readFileSync(
  new URL("../../app/page.tsx", import.meta.url),
  "utf8",
);
const homeCss = readFileSync(
  new URL("../../app/public-home.module.css", import.meta.url),
  "utf8",
);
const help = readFileSync(
  new URL(
    "../../app/(trust)/[...document]/public-help-document.tsx",
    import.meta.url,
  ),
  "utf8",
);
const trustPage = readFileSync(
  new URL("../../app/(trust)/[...document]/page.tsx", import.meta.url),
  "utf8",
);
const support = readFileSync(
  new URL("../../app/support/page.tsx", import.meta.url),
  "utf8",
);
const supportCss = readFileSync(
  new URL("../../app/support/support-page.module.css", import.meta.url),
  "utf8",
);

const forbiddenAmounts = ["5,054,281", "50,000,000", "₩5,000,000"];

describe("공개 화면 구도", () => {
  it("첫 화면은 문구, 그림, 시작 카드 순이다", () => {
    const copyAt = home.indexOf('className="hero__copy"');
    const visualAt = home.indexOf(
      'className="hero__visual landing-hero__visual"',
    );
    const actionAt = home.indexOf("styles.action");

    expect(copyAt).toBeGreaterThan(-1);
    expect(visualAt).toBeGreaterThan(copyAt);
    expect(actionAt).toBeGreaterThan(visualAt);
    expect(home).toContain('href="/about"');
    expect(home).toContain('href="/how-it-works"');
    expect(home).toContain('href="/faq"');
    expect(home).toContain('href="/support"');
    expect(home).toContain("최대 5,000원 환영 보상");
    expect(home).not.toContain("components/auth");
    expect(home).not.toContain("휴대폰 인증");
    expect(home).not.toContain("반도체");
    for (const amount of forbiddenAmounts) {
      expect(home).not.toContain(amount);
    }
    expect(homeCss).toContain("minmax(15rem, 0.86fr)");
  });

  it("소개와 질문, 이용 방법만 목록 구도를 쓴다", () => {
    expect(trustPage).toContain('path === "/about"');
    expect(trustPage).toContain('path === "/faq"');
    expect(trustPage).toContain('path === "/how-it-works"');
    expect(trustPage).toContain('className="trust-document"');
    expect(help).toContain("styles.rows");
    expect(help).toContain("공식 사실");
    expect(help).not.toContain("trust-document__hero");
    expect(help).not.toContain("휴대폰 인증");
    expect(help).not.toContain("반도체");
  });

  it("고객지원은 같은 도움말 목록이다", () => {
    expect(support).toContain("필요한 도움을 바로");
    expect(support).toContain('aria-label="도움말"');
    expect(support).toContain("styles.icon");
    expect(support).not.toContain("휴대폰 인증");
    expect(supportCss).toContain("grid-template-columns: auto minmax(0, 1fr)");
  });
});
