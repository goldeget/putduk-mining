import { mkdirSync } from "node:fs";

import { test as setup } from "@playwright/test";

import { createConfirmedMember } from "../e2e/fixtures/local-auth";
import {
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "../e2e/authenticated/helpers/admin-totp";

const statePath = "test-results/typography-protected/admin.json";

setup("운영자 세션을 준비한다", async ({ page }) => {
  setup.setTimeout(180_000);
  mkdirSync("test-results/typography-protected", { recursive: true });
  const operator = await createConfirmedMember("ws05-typography-admin");
  await grantAdminRole(operator.userId);
  try {
    await completeAdminLoginWithTotp(page, operator.email, operator.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("계정 서비스를 연결하지 못했어요")) throw error;
    await completeAdminLoginWithTotp(page, operator.email, operator.password);
  }
  await page.context().storageState({ path: statePath });
});
