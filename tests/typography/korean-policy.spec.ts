import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { assertTypographyClean } from "./helpers";
import {
  assertUniqueDocumentIds,
  assertVisibleControlsNamed,
} from "./rendered-health";

const policy = readFileSync(
  path.resolve("lib/design/korean-typography.css"),
  "utf8",
);
const REQUIRED_WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1440] as const;

// Real Chromium layout of the shared policy, not additional product screenshots.
// No network, auth/session, provider or database fixture is needed by these cases.
for (const width of REQUIRED_WIDTHS) {
  test(`shared Korean policy ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<!doctype html><html lang="ko"><body>
      <main><article>
        <h1>자연스러운 한국어 안내</h1>
        <p id="ordinary">안녕하세요. 퍼뜩 채굴에 오신 것을 환영합니다. 내 기록을 확인해 주세요.</p>
        <p id="long">공백없이이어지는매우긴한국어문자열에서도레이아웃이넘치지않으며정보전체를읽을수있어야합니다공백없이이어지는매우긴한국어문자열입니다</p>
        <p lang="en" id="english">A long identifier may wrap only when its whole token cannot fit.</p>
        <p lang="ja" id="japanese">日本語の文章は標準の改行規則を維持します。</p>
        <p class="machine-token" id="machine">https://putduk.test/${"identifier".repeat(18)}</p>
        <p class="user-copy" id="user">첫 번째 줄\n두 번째 줄</p>
        <p>출금 금액 18,420원 · 기록 ID 20261013</p>
        <label for="value">입력 내용</label><input id="value" value="안내" />
        <button type="button">확인</button>
        <div role="status">현재 상태 안내</div>
        <svg aria-hidden="true" width="12" height="12"><path d="M0 0h12v12z" /></svg>
      </article></main></body></html>`);
    await page.addStyleTag({ content: policy });
    await page.addStyleTag({
      content: `*{box-sizing:border-box}body{margin:0;padding:16px;font:16px/1.6 Arial,sans-serif}main{display:grid;grid-template-columns:minmax(0,1fr)}article{min-width:0}p,h1{max-width:14rem}p{margin:12px 0}input{max-width:100%}.user-copy{white-space:pre-wrap}button{max-width:100%;padding:8px 16px}`,
    });
    await expect(page.locator("#ordinary")).toHaveCSS("word-break", "keep-all");
    await expect(page.locator("#ordinary")).toHaveCSS(
      "overflow-wrap",
      "break-word",
    );
    await expect(page.locator("#english")).toHaveCSS("word-break", "normal");
    await expect(page.locator("#japanese")).toHaveCSS("word-break", "normal");
    await expect(page.locator("#japanese")).toHaveCSS("line-break", "auto");
    await expect(page.locator("#machine")).toHaveCSS(
      "overflow-wrap",
      "anywhere",
    );
    await expect(page.locator("#user")).toHaveCSS("white-space", "pre-wrap");
    await expect(page.locator("#user")).toHaveText("첫 번째 줄\n두 번째 줄", {
      useInnerText: true,
    });
    const newline = await page.locator("#user").evaluate((element) => {
      const node = element.firstChild!;
      const text = node.textContent!;
      const start = document.createRange();
      start.setStart(node, 0);
      start.setEnd(node, 1);
      const next = document.createRange();
      const index = text.indexOf("\n") + 1;
      next.setStart(node, index);
      next.setEnd(node, index + 1);
      return {
        unchanged: text === "첫 번째 줄\n두 번째 줄",
        firstTop: start.getBoundingClientRect().top,
        nextTop: next.getBoundingClientRect().top,
      };
    });
    expect(newline.unchanged).toBe(true);
    expect(newline.nextTop).toBeGreaterThan(newline.firstTop);
    await assertTypographyClean(page, `shared-policy-${width}`, testInfo);
    await assertUniqueDocumentIds(page);
    await assertVisibleControlsNamed(page);
    if (width === 320) {
      // Prove the additive health checks reject defects; noninteractive status
      // and decorative graphics above intentionally need no control name.
      await page
        .locator("main")
        .evaluate((element) =>
          element.insertAdjacentHTML(
            "beforeend",
            '<span id="ordinary" hidden></span>',
          ),
        );
      await expect(assertUniqueDocumentIds(page)).rejects.toThrow(
        "Document IDs must be unique",
      );
      await page
        .locator("span#ordinary")
        .evaluate((element) => element.remove());
      await page.locator("button").evaluate((element) => {
        element.textContent = "";
      });
      await expect(assertVisibleControlsNamed(page)).rejects.toThrow(
        "needs an accessible name",
      );
    }
  });
}
