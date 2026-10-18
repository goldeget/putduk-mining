import { test } from "@playwright/test";

import { runAllocatedHomeDark } from "./helpers/catalog-allocated-home-dark-run";

test("fresh allocated home dark retains the wide widths and text scales without financial mutation", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(360_000);
  await runAllocatedHomeDark(page, browser, info, [834, 1024, 1440]);
});
