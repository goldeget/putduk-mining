import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const homePage = readFileSync("app/(product)/home/page.tsx", "utf8");
const homeCss = readFileSync("app/(product)/home/home.module.css", "utf8");
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
    expect(homePage).not.toMatch(/인정 원금|현재 등급|채굴 용량|대기 수익/);
    expect(homeCss).toMatch(
      /\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(homeCss).toMatch(/\.livingWorld\s*\{[^}]*grid-row:\s*1/s);
    expect(homeCss).toMatch(
      /\.summary\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(homeCss).toMatch(/grid-row:\s*2/);
  });

  it("더보기는 목록이며 세 칸 카드 격자로 나누지 않는다", () => {
    expect(menuPage).not.toMatch(/보유 자산|누적 채굴|L5|원금/);
    expect(menuPage).toContain('aria-label="내 퍼뜩 메뉴"');
    expect(menuCss).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(menuCss).not.toMatch(/repeat\(3,/);
  });
});
