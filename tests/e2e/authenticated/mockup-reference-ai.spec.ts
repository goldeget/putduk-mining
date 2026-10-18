import { test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  captureRoutes,
  sourceReferences,
} from "./helpers/mockup-reference-capture";
import { loginAsMember } from "./helpers/member-session";

test("captures reconstructed ai at seven widths and 200 percent Korean text", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("ai-reference-reconstruction");
  await loginAsMember(page, member, "/ai");
  await captureRoutes(page, testInfo, ["/ai"], references);
});
