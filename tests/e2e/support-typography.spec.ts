import { expect, test } from "@playwright/test";

import {
  assertTypographyClean,
  installTypographyTheme,
} from "../typography/helpers";

test("public support keeps Korean tokens intact at 390 light, dark, and 200%", async ({
  page,
}) => {
  test.setTimeout(180_000);

  for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 390, height: 844 });
    await installTypographyTheme(page, theme);
    await page.goto("/support", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "필요한 도움을 바로 확인해요." }),
    ).toBeVisible();
    await assertTypographyClean(page, `support public 390 ${theme}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await installTypographyTheme(page, "light");
  await page.goto("/support", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(
    page.getByRole("heading", { name: "필요한 도움을 바로 확인해요." }),
  ).toBeVisible();
  await assertTypographyClean(page, "support public 390 light 200%");
});
