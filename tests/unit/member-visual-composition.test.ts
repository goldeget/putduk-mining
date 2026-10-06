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
const menuCss = readFileSync("app/(product)/menu/menu.module.css", "utf8");
const walletCss = readFileSync(
  "components/product/wallet-read-view.module.css",
  "utf8",
);
const walletView = readFileSync(
  "components/product/wallet-read-view.tsx",
  "utf8",
);
const stageCss = readFileSync(
  "components/mining-live/mining-live-stage.module.css",
  "utf8",
);

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
    expect(homePage).toContain("사용 가능 KRW");
    expect(homePage).toContain("오늘 채굴");
    expect(homePage).toContain("아직 없어요");
    expect(homePage).toContain("공개된 상품이 아직 없어요");
    expect(homePage).not.toMatch(/54[,.]?281|5,000,000|12\.8%|\+11\.4%|L5 PRO/);
    expect(homePage).not.toMatch(/인정 원금|채굴 용량|대기 수익/);
    expect(homePage).toContain("className={styles.featureBand}");
    expect(homePage).toContain("className={styles.aiStrip}");
    expect(homePage).toContain('<Link href="/notifications">전체 보기</Link>');
    expect(homePage).toContain('<Link href="/products">상품 보기</Link>');
    expect(homePage.match(/>전체 보기</g)).toHaveLength(1);
    expect(homeCss).toMatch(
      /\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(homeCss).toMatch(/\.livingWorld\s*\{[^}]*grid-row:\s*1/s);
    expect(homeCss).toMatch(
      /\.summary\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(homeCss).toMatch(/grid-row:\s*2/);
    expect(homeCss).toMatch(/\.profileStats\s*\{/);
    expect(homeCss).toMatch(/\.featureBand\s*\{/);
    expect(homeCss).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("더보기는 가입 정보와 두 열 목록을 같이 둔다", () => {
    expect(menuPage).toContain("readMemberScreenFacts");
    expect(menuPage).toContain("가입일");
    expect(menuPage).toContain("누적 채굴");
    expect(menuPage).toContain("아직 표시할 수 없어요");
    expect(menuPage).not.toMatch(/L5 PRO|54,281|보유 자산/);
    expect(menuPage).toContain("<h1>더보기</h1>");
    expect(menuPage.match(/aria-label="더보기 메뉴"/g)).toHaveLength(1);
    const hubStart = menuPage.indexOf('aria-label="더보기 메뉴"');
    const hub = menuPage.slice(hubStart, menuPage.indexOf("</nav>", hubStart));
    expect(hub).toContain("<MenuList items={links} />");
    expect(hub).toContain("<MenuList items={settings} />");
    expect(menuPage).not.toContain('aria-label="더보기 설정"');
    expect(menuCss).toMatch(
      /\.board\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(menuCss).toMatch(
      /\.memberStats\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(menuCss).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("채굴 금액은 장면 아래에 두고 원금과 정산 전을 한 칸으로 합치지 않는다", () => {
    const stageEnd = miningPage.indexOf("</MiningLiveStage>");
    const stageStart = miningPage.indexOf("<MiningLiveStage");
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageEnd).toBeGreaterThan(stageStart);
    expect(miningPage.slice(stageStart, stageEnd)).not.toContain(
      "MiningAmountBoard",
    );
    expect(miningPage.slice(stageEnd)).toContain('placement="lead"');
    expect(miningPage.slice(stageEnd)).toContain('placement="follow"');
    expect(miningPage).not.toMatch(/원금\s*\+|정산 전\s*\+|확인 전\s*\+/);
    expect(stageCss).toMatch(/calc\(100dvh - 25rem\)/);
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

  it("상품은 카드 격자이며 가격과 anywhere 줄바꿈을 넣지 않는다", () => {
    expect(catalogCss).toMatch(/\.products\s*\{[^}]*display:\s*grid/s);
    expect(catalogCss).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(catalogCss).not.toMatch(/overflow-wrap:\s*anywhere/);
  });
});
