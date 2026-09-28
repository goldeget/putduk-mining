import { mkdirSync } from "node:fs";

import { test as setup } from "@playwright/test";

import { createConfirmedMember } from "../e2e/fixtures/local-auth";
import { loginAsMember } from "../e2e/authenticated/helpers/member-session";

const statePath = "test-results/typography-protected/member.json";

setup("회원 세션을 준비한다", async ({ page }) => {
  setup.setTimeout(180_000);
  mkdirSync("test-results/typography-protected", { recursive: true });
  const member = await createConfirmedMember("ws05-typography-user");
  try {
    await loginAsMember(page, member, "/home");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("계정 서비스를 연결하지 못했어요")) throw error;
    await loginAsMember(page, member, "/home");
  }
  await page.context().storageState({ path: statePath });
});
