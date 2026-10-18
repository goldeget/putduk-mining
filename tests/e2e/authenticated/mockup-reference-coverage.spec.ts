import { test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  captureRoutes,
  sourceReferences,
} from "./helpers/mockup-reference-capture";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

test("captures every member reference family without fabricated balances or activity", async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("mockup-reference-empty");
  await loginAsMember(page, member, "/home");
  await dismissGuidedQuestIfPresent(page);
  await captureRoutes(
    page,
    testInfo,
    ["/home", "/mining", "/products", "/wallet", "/menu", "/ai"],
    references,
  );
});
