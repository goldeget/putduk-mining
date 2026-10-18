import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/(product)/mining/page.tsx", "utf8");
const css = readFileSync("app/(product)/mining/page.module.css", "utf8");
const summaryCss = readFileSync(
  "components/product/mining-live-summary.module.css",
  "utf8",
);

describe("mining page composition after the live upgrade", () => {
  it("drives both scene paths from the server-confirmed running state", () => {
    const stageStart = page.indexOf("{selectedArt ? (");
    const stageEnd = page.indexOf('aria-label="채굴 현황"');
    const stage = page.slice(stageStart, stageEnd);
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageEnd).toBeGreaterThan(stageStart);
    expect(stage.match(/running=\{presentation\.running\}/g)).toHaveLength(2);
    expect(stage).not.toContain("running={false}");
    expect(page).toContain("readOwnMiningServerDisplay(identity)");
    expect(page).toContain("resolveMiningPresentation({");
  });
  it("keeps the scene, then the caption, principal, capacity and period in order", () => {
    const stageEnd = page.indexOf('aria-label="채굴 현황"');
    const caption = page.indexOf("className={styles.sceneCaption}");
    const principal = page.indexOf("value={facts.principal}");
    const capacity = page.indexOf('id="mining-capacity-title"');
    const period = page.indexOf('aria-label="채굴 기간"');
    expect(caption).toBeGreaterThan(stageEnd);
    expect(principal).toBeGreaterThan(caption);
    expect(capacity).toBeGreaterThan(principal);
    expect(period).toBeGreaterThan(capacity);
    expect(page).toContain("<dd>{facts.pending}</dd>");
    expect(page).toContain("<dd>{facts.committed}</dd>");
    expect(page).not.toMatch(/원금\s*\+|정산 전\s*\+|확인 전\s*\+/);
    expect(page).not.toContain("Math.random");
    expect(page).not.toContain("MiningAmountBoard");
  });
  it("names the page heading by its visible text", () => {
    expect(page).toContain("<h1>퍼뜩 채굴</h1>");
    expect(page).not.toMatch(/<h1[^>]*aria-label/);
    expect(page).not.toContain('id="world-hero-title"');
  });
  it("removed the unused amount board and keeps one summary rule", () => {
    expect(existsSync("components/product/mining-amount-board.tsx")).toBe(
      false,
    );
    expect(existsSync("components/product/mining-amount-board.module.css")).toBe(
      false,
    );
    expect(summaryCss.match(/^\.summary\s*\{/gm)).toHaveLength(1);
  });
  it("keeps the hero layout contract", () => {
    expect(css).toMatch(/\.sceneCaption\s*\{[^}]*position:\s*relative/s);
    expect(css).toMatch(/\.rail\s*\{/);
    expect(css).toMatch(/\.controlRoom\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.records\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.hero\s*\{[^}]*min-height:\s*clamp\(/s);
  });
});
