import { test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  captureRoutes,
  sourceReferences,
} from "./helpers/mockup-reference-capture";
import { loginAsMember } from "./helpers/member-session";

test("captures reconstructed wallet at seven widths with real links and keyboard selection", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("wallet-reference-reconstruction");
  await loginAsMember(page, member, "/wallet");
  await captureRoutes(page, testInfo, ["/wallet"], references);
});
