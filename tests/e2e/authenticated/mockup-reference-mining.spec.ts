import { test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  captureRoutes,
  sourceReferences,
} from "./helpers/mockup-reference-capture";
import { loginAsMember } from "./helpers/member-session";

test("captures reconstructed mining at seven widths with genuine read-only controls", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("mining-reference-reconstruction");
  await loginAsMember(page, member, "/mining");
  await captureRoutes(page, testInfo, ["/mining"], references);
});
