import { mkdirSync } from "node:fs";

import { test as setup } from "@playwright/test";

import { createConfirmedMember } from "../e2e/fixtures/local-auth";
import {
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "../e2e/authenticated/helpers/admin-totp";

const statePath = "test-results/typography-protected/admin.json";

function isRetryableAdminSetupError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  // 첫 비밀번호 확인 직후 GoTrue의 /user 조회가 DB 재연결로 504가 되면
  // 다중 인증 화면이 로그인으로 되돌아간다. 서버 액션 컴파일 이후 한 번은 다시 시도한다.
  return (
    message.includes("계정 서비스를 연결하지 못했어요") ||
    message.includes("TOTP_ENROLMENT_UI_MISSING") ||
    message.includes("ADMIN_LOGIN_UI_MISSING") ||
    message.includes("입력한 정보로 운영자 로그인을 완료할 수 없습니다")
  );
}

setup("운영자 세션을 준비한다", async ({ page }) => {
  setup.setTimeout(360_000);
  mkdirSync("test-results/typography-protected", { recursive: true });
  const operator = await createConfirmedMember("ws05-typography-admin");
  await grantAdminRole(operator.userId);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await completeAdminLoginWithTotp(page, operator.email, operator.password);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (!isRetryableAdminSetupError(error) || attempt === 2) {
        throw error;
      }
      await page.context().clearCookies();
    }
  }
  if (lastError) {
    throw lastError;
  }
  await page.context().storageState({ path: statePath });
});
