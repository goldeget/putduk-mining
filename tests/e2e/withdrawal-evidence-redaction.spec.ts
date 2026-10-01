import { expect, test } from "@playwright/test";

import { captureRedactedWithdrawalEvidence } from "./authenticated/helpers/withdrawal-evidence";

// This isolated HTML fixture tests capture privacy, not a mocked money flow.
test.use({ trace: "off", video: "off", screenshot: "off" });

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: scrolled full-page evidence hides inputs without changing them`, async ({
    page,
  }) => {
    await page.setContent(`<!doctype html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        html { scroll-behavior: smooth; }
        body { margin: 0; min-height: 1900px; color: ${theme === "dark" ? "white" : "black"}; background: ${theme === "dark" ? "#090907" : "#faf7ee"}; font: 16px sans-serif; }
        header { position: fixed; top: 0; padding: 16px; background: #dab260; }
        main { padding: 900px 16px 200px; }
        input { display: block; box-sizing: border-box; width: 100%; height: 48px; margin: 12px 0; background: white; color: black; }
      </style></head><body><header>퍼뜩</header><main>
      <h1>변경 전 비밀번호 확인</h1>
      <input name="destinationReauthPassword" type="text" aria-label="비밀번호">
      <input name="destinationReauthTotp" aria-label="인증 코드">
      <input name="accountHolder" aria-label="예금주">
      <input name="accountNumber" aria-label="계좌번호">
      <input name="address" aria-label="주소">
      <p>비밀번호와 인증 정보를 다시 확인해 주세요.</p>
      </main></body></html>`);
    const inputs = page.locator("input");
    for (let i = 0; i < 5; i++) await inputs.nth(i).fill(`fixture-first-${i}`);
    await inputs.first().focus();
    await page.evaluate(() =>
      window.scrollTo({ top: 1400, behavior: "instant" }),
    );
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const first = await captureRedactedWithdrawalEvidence(
      page,
      test.info().outputPath(`redaction-${theme}-first.png`),
    );
    await expect(inputs.first()).toBeVisible();
    await expect(inputs.first()).toBeFocused();
    await expect(inputs.first()).toHaveValue("fixture-first-0");
    expect(
      await inputs.first().evaluate((input) => getComputedStyle(input).opacity),
    ).toBe("1");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).toBe("smooth");
    expect(first.readUInt32BE(16)).toBe(page.viewportSize()!.width);
    const plain = await page.screenshot({
      fullPage: true,
      scale: "css",
      caret: "hide",
      animations: "disabled",
    });
    expect(first.equals(plain)).toBe(false);
    for (let i = 0; i < 5; i++)
      await inputs.nth(i).fill(`different-fixture-second-${i}`);
    await inputs.first().focus();
    await page.evaluate(() =>
      window.scrollTo({ top: 1400, behavior: "instant" }),
    );
    const second = await captureRedactedWithdrawalEvidence(
      page,
      test.info().outputPath(`redaction-${theme}-second.png`),
    );
    // Different sensitive values must produce identical redacted pixel bytes.
    expect(first.equals(second)).toBe(true);
    await expect(inputs.first()).toBeVisible();
    await expect(inputs.first()).toBeFocused();
    await expect(inputs.first()).toHaveValue("different-fixture-second-0");
    expect(
      await inputs.first().evaluate((input) => getComputedStyle(input).opacity),
    ).toBe("1");
    expect(
      await page.evaluate(() =>
        document.documentElement.style.getPropertyValue("scroll-behavior"),
      ),
    ).toBe("");
    await test.info().attach(`redaction-${theme}`, {
      path: test.info().outputPath(`redaction-${theme}-second.png`),
      contentType: "image/png",
    });
  });
}
