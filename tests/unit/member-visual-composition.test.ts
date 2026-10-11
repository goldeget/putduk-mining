import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const homePage = readFileSync("app/(product)/home/page.tsx", "utf8");
const homeCss = readFileSync("app/(product)/home/home.module.css", "utf8");
const miningPage = readFileSync("app/(product)/mining/page.tsx", "utf8");
const catalogCss = readFileSync(
  "components/product/published-catalog-view.module.css",
  "utf8",
);
const menuPage = readFileSync("app/(product)/menu/page.tsx", "utf8");
const menuView = readFileSync(
  "components/product/member-menu-view.tsx",
  "utf8",
);
const menuCss = readFileSync(
  "components/product/member-menu-view.module.css",
  "utf8",
);
const catalogCard = readFileSync(
  "components/product/catalog-product-card.tsx",
  "utf8",
);
const walletCss = readFileSync(
  "components/product/wallet-read-view.module.css",
  "utf8",
);
const walletView = readFileSync(
  "components/product/wallet-read-view.tsx",
  "utf8",
);
const miningCss = readFileSync("app/(product)/mining/page.module.css", "utf8");

describe("회원 화면 구도", () => {
  it("지갑의 세 값은 같은 줄의 카드로 두고 미확정을 합계 칸으로 늘리지 않는다", () => {
    expect(walletCss).toMatch(
      /\.metrics\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    // The history introduction may span its two columns. Only the unconfirmed
    // money card must never become a combined, full-width total.
    expect(walletCss).not.toMatch(
      /\.metric\[data-funding-tone="unconfirmed"\]\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
    expect(walletCss).toMatch(/data-funding-tone="unconfirmed"/);
    expect(walletCss).toMatch(/border-style:\s*dashed/);
  });

  it("홈은 회원 표시값과 공개 상품만 두고 목업 금액을 넣지 않는다", () => {
    expect(homePage).toContain("readMemberScreenFacts");
    expect(homePage).toContain("getPublishedCatalog");
    expect(homePage).toContain("사용 가능 원화");
    expect(homePage).toContain("오늘 채굴");
    expect(homePage).toContain("아직 없어요");
    expect(homePage).toContain("공개된 상품이 아직 없어요");
    expect(homePage).not.toMatch(/54[,.]?281|5,000,000|12\.8%|\+11\.4%|L5 PRO/);
    expect(homePage).not.toMatch(
      /대기 수익|원금\s*\+|정산 전\s*\+|확인 전\s*\+/,
    );
    expect(homePage).toMatch(
      /presentHomeFundingFacts\(\s*fundedDisplay,\s*fundedUnavailable,?\s*\)/s,
    );
    expect(homePage).toContain("fundingFacts.principal");
    expect(homePage).toContain("fundingFacts.remainingCapacity");
    expect(homePage).toContain("className={styles.featureBand}");
    expect(homePage).toContain('<PutdukAiDock presentation="inline" />');
    expect(homePage).toContain("<SemiconductorTowerScene");
    expect(homePage).not.toContain("<MiningCore");
    expect(homePage).toContain('<Link href="/notifications">전체 보기</Link>');
    expect(homePage).toMatch(/<Link href="\/products">/);
    expect(homePage).toContain("상품 보기");
    expect(homePage.match(/>전체 보기</g)).toHaveLength(1);
    expect(homeCss).toMatch(
      /\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(homePage.indexOf("<ProductHeader home")).toBeLessThan(
      homePage.indexOf("<div className={styles.livingWorld}>"),
    );
    expect(homeCss).not.toMatch(/\.livingWorld\s*\{[^}]*\n\s*height:\s*\d+px/s);
    expect(homeCss).toMatch(
      /\.summaryGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );

    const quickActions = homePage.slice(
      homePage.indexOf("<nav className={styles.quickActions}"),
      homePage.indexOf(
        "</nav>",
        homePage.indexOf("<nav className={styles.quickActions}"),
      ),
    );
    const primaryActions = quickActions.slice(
      quickActions.indexOf("data-home-primary-actions"),
      quickActions.indexOf("</div>"),
    );
    // The theme substitutes the fourth action; all three money/mining links
    // stay navigable, and the dialog launcher is outside the four-action group.
    const hrefs = [...primaryActions.matchAll(/href="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(hrefs).toEqual([
      "/mining",
      "/wallet/deposit",
      "/wallet/withdraw",
      "/events",
      "/wallet?view=history",
    ]);
    expect(primaryActions).not.toContain("PutdukAiDock");
    expect(quickActions.indexOf("<PutdukAiDock")).toBeGreaterThan(
      quickActions.indexOf("</div>"),
    );
    expect(homeCss).not.toMatch(/\.quickActions\s*\{[^}]*auto-fit/s);
    expect(homeCss).toMatch(/\.profileStats\s*\{/);
    expect(homeCss).toMatch(/\.featureBand\s*\{/);
    expect(homeCss).toMatch(
      /\.welcomeTitle span\s*\{[^}]*overflow-wrap:\s*anywhere/s,
    );
  });

  it("더보기는 실제 회원 정보와 데스크톱 두 열 메뉴를 같이 둔다", () => {
    expect(menuPage).toContain("readMemberScreenFacts(identity)");
    expect(menuPage).toContain("<MemberMenuView facts={facts}");
    expect(menuView).toContain("가입일");
    expect(menuView).toContain("formatJoinedOn(facts.joinedAt)");
    expect(menuView).toContain("facts.availableKrwAtomic");
    expect(menuView).toContain("facts.walletUnavailable");
    expect(menuView).toContain("누적 채굴");
    expect(menuView).toContain("아직 표시할 수 없어요");
    expect(menuView).not.toMatch(/L5 PRO|54,281|보유 자산/);
    expect(menuView).toContain("<h1>더보기</h1>");
    expect(menuView.match(/aria-label="더보기 메뉴"/g)).toHaveLength(1);
    expect(menuView).toContain("className={styles.primaryColumn}");
    expect(menuView).toContain("className={styles.settingsColumn}");
    expect(menuView).toContain("<ThemeControl />");
    expect(menuView).not.toContain('aria-label="더보기 설정"');
    expect(menuCss).toMatch(
      /\.board\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s,
    );
    expect(menuCss).toMatch(
      /\.stats\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
  });

  it("채굴 장면과 금액 기록을 분리하고 원금과 정산 전을 한 칸으로 합치지 않는다", () => {
    const stageStart = miningPage.indexOf("<MiningReferenceScene");
    const stageEnd = miningPage.indexOf('aria-label="채굴 현황"');
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageEnd).toBeGreaterThan(stageStart);
    expect(miningPage.slice(stageStart, stageEnd)).not.toContain(
      "MiningAmountBoard",
    );
    expect(miningPage.slice(stageEnd)).toContain("value={facts.principal}");
    expect(miningPage.slice(stageEnd)).toContain("<dd>{facts.pending}</dd>");
    expect(miningPage.slice(stageEnd)).toContain("<dd>{facts.committed}</dd>");
    expect(miningPage).not.toMatch(/원금\s*\+|정산 전\s*\+|확인 전\s*\+/);
    expect(miningCss).toMatch(/\.hero\s*\{[^}]*min-height:\s*clamp\(/s);
    expect(miningCss).toMatch(/\.rail\s*\{/);
    expect(walletView).toContain('value="principal"');
    expect(walletView).toContain('value="profit"');
    expect(walletView).toContain('value="history"');
    expect(walletView).toContain('id="ledger-history-title"');
    expect(walletView).toContain(">최근 거래 내역</h2>");
    expect(walletCss).toMatch(
      /\.ledgerTabs \.tabPanel\[data-panel="history"\]\s*\{[^}]*display:\s*grid/s,
    );
    expect(walletCss).not.toMatch(/value="history"\]:checked/);
    expect(walletView).toContain("아직 거래 내역이 없어요");
    expect(walletView).not.toMatch(
      /eligible_principal_micro_krw\s*\+|pending_micro_krw\s*\+/,
    );
  });

  it("상품 격자는 화면에 맞춰 재배치하고 실제 상품 데이터만 표시한다", () => {
    expect(catalogCss).toMatch(/\.products\s*\{[^}]*display:\s*grid/s);
    // Exact CSS tracks are exercised by the real normal/200% browser matrix.
    // This guard retains data/financial truth rather than freezing one layout.
    expect(catalogCard).toContain("product.nameKo");
    expect(catalogCard).toContain("product.availability");
    expect(catalogCard).not.toMatch(
      /54[,.]?281|5,000,000|12\.8%|\+11\.4%|L5 PRO/,
    );
  });
});
