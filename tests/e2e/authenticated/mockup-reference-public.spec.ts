import { test } from "@playwright/test";

import {
  captureRoutes,
  sourceReferences,
} from "./helpers/mockup-reference-capture";

test("captures every public authentication reference family with live controls", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  await captureRoutes(page, testInfo, ["/login", "/signup"], references);
});
