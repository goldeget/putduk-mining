import { test } from "@playwright/test";

import { runAllocatedHomeDark } from "./helpers/catalog-allocated-home-dark-run";

test("fresh allocated home dark retains the narrow widths and text scales without financial mutation", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(360_000);
  await runAllocatedHomeDark(page, browser, info, [320, 360, 390, 430]);
});
