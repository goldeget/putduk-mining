import { expect, type Page } from "@playwright/test";

const SENSITIVE_CONTROLS =
  'input[name="destinationReauthPassword"],input[name="destinationReauthTotp"],input[name="accountHolder"],input[name="accountNumber"],input[name="address"]';

/** Screenshot-only redaction. Never clear values or alter the tested flow. */
export async function captureRedactedWithdrawalEvidence(
  page: Page,
  screenshotPath: string,
) {
  // Full-page mask overlays can drift from mobile controls at a scrolled origin.
  const scrollBehavior = await page.evaluate(() => {
    const root = document.documentElement.style;
    const prior = {
      value: root.getPropertyValue("scroll-behavior"),
      priority: root.getPropertyPriority("scroll-behavior"),
    };
    root.setProperty("scroll-behavior", "auto", "important");
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    return prior;
  });
  try {
    // Settle pending focus-induced smooth scrolling before measuring overlays.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, left: 0, behavior: "instant" });
            requestAnimationFrame(() => resolve());
          });
        }),
    );
    await expect
      .poll(() => page.evaluate(() => ({ x: scrollX, y: scrollY })))
      .toEqual({ x: 0, y: 0 });
    return await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      scale: "css",
      animations: "disabled",
      caret: "hide",
      // Defense in depth: capture-only CSS hides values even if overlays drift.
      // Opacity preserves geometry/focus; Playwright removes it afterward.
      style: `${SENSITIVE_CONTROLS} { opacity: 0 !important; }`,
      mask: [page.locator(SENSITIVE_CONTROLS)],
    });
  } finally {
    await page.evaluate(({ value, priority }) => {
      if (value)
        document.documentElement.style.setProperty(
          "scroll-behavior",
          value,
          priority,
        );
      else document.documentElement.style.removeProperty("scroll-behavior");
    }, scrollBehavior);
  }
}
