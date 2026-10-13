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
  it("첫 화면은 읽을 수 있는 문구와 월드, 시작 안내를 제공한다", () => {
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
    expect(home).toContain("조건 자세히 보기");
    expect(home).toContain("체험 값과 실제 원화 지갑은 별개");
    expect(homeCss).toContain("prefers-reduced-motion: reduce");
    expect(home).not.toContain("putduk-miner-384-v1");
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
