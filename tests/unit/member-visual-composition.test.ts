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

describe("회원 화면 구도", () => {
  it("지갑의 세 값은 같은 줄의 카드로 두고 미확정을 합계 칸으로 늘리지 않는다", () => {
    expect(walletCss).toMatch(
      /\.metrics\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(walletCss).not.toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(walletCss).toMatch(/data-funding-tone="unconfirmed"/);
    expect(walletCss).toMatch(/border-style:\s*dashed/);
  });

  it("홈은 장면 아래 기존 카드만 두고 원금·등급·용량을 추가하지 않는다", () => {
    expect(homePage).not.toMatch(
      /인정 원금|현재 등급|채굴 용량|대기 수익|오늘 채굴/,
    );
    expect(homePage).toContain("사용 가능 KRW");
    expect(homePage).toContain("className={styles.featureBand}");
    expect(homePage).toContain("className={styles.aiStrip}");
    expect(homeCss).toMatch(
      /\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(homeCss).toMatch(/\.livingWorld\s*\{[^}]*grid-row:\s*1/s);
    expect(homeCss).toMatch(
      /\.summary\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(homeCss).toMatch(/grid-row:\s*2/);
    expect(homeCss).toMatch(/\.featureBand\s*\{/);
    expect(homeCss).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("더보기는 장면과 한 줄 목록이며 세 칸 카드 격자로 나누지 않는다", () => {
    expect(menuPage).not.toMatch(/보유 자산|누적 채굴|L5|원금/);
    expect(menuPage).toContain("<h1>더보기</h1>");
    expect(menuPage).toContain('aria-label="더보기 메뉴"');
    expect(menuCss).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(menuCss).not.toMatch(/repeat\(3,/);
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
  });

  it("상품은 카드 격자이며 가격과 anywhere 줄바꿈을 넣지 않는다", () => {
    expect(catalogCss).toMatch(/\.products\s*\{[^}]*display:\s*grid/s);
    expect(catalogCss).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(catalogCss).not.toMatch(/overflow-wrap:\s*anywhere/);
  });
});
