import { expect, test } from "@playwright/test";

import { assertTypographyClean } from "./helpers";

// Test the audit against real Chromium text layout. These small fixtures prove
// the checker, rather than counting as product route or visual acceptance.
test("rendered copy rejects joined inline sentences", async ({ page }) => {
  await page.setContent(
    "<p><span>안녕하세요.</span><span>저는 운영자입니다.</span></p>",
  );
  await expect(assertTypographyClean(page, "inline")).rejects.toThrow(
    "Korean rendered copy spacing",
  );
});

test("semantic line breaks and explicit spaces remain valid", async ({
  page,
}) => {
  await page.setContent(
    "<p><span>안녕하세요.</span><br><span>저는 운영자입니다.</span></p><p><span>안녕하세요.</span> <span>저는 운영자입니다.</span></p><p>18,420원 · 0.090108원 · 1.20× · 2026.10.07</p>",
  );
  await assertTypographyClean(page, "intentional-boundaries");
});

test("accessible copy is checked even when visible copy is correct", async ({
  page,
}) => {
  await page.setContent('<button aria-label="회원 입니다.">회원 정보</button>');
  await expect(assertTypographyClean(page, "accessible-copy")).rejects.toThrow(
    "Korean rendered copy spacing",
  );
});

test("actual mid-word Korean wrapping remains a failure", async ({ page }) => {
  await page.setContent(
    '<p style="width: 1em; word-break: break-all; font-size: 20px">운영자입니다</p>',
  );
  await expect(assertTypographyClean(page, "word-wrap")).rejects.toThrow(
    "Korean token split across lines",
  );
});
