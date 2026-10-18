import { expect, test, type Page } from "@playwright/test";
import { E2E_FORCE_REST_FAILURE_COOKIE } from "@/lib/supabase/server-fetch";
import { createConfirmedMember } from "../fixtures/local-auth";
import {
  advanceTrialToCompleted,
  ensureLocalTrialProgram,
} from "./helpers/eligibility";
import { loginAsMember, startTrialFromUi } from "./helpers/member-session";
import { expectSettledRoute } from "./helpers/settled-route";

async function expectNoInitialGuidance(page: Page) {
  await expectSettledRoute(page, "/start");
  await expect(
    page.getByRole("button", { name: "처음 안내 다시 보기", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-guided-quest]")).toHaveCount(0);
}

test("체험 완료자는 새 기기·저장소 삭제·조회 실패에도 최초 안내가 다시 나오지 않는다", async ({
  page,
  browser,
}) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("ONBOARDING_E2E_BASE_URL_REQUIRED");
  await ensureLocalTrialProgram();
  const member = await createConfirmedMember("no-repeat-onboarding");
  await loginAsMember(page, member, "/start");
  await expect(
    page.getByRole("button", { name: "처음 안내 다시 보기", exact: true }),
  ).toBeVisible();
  await startTrialFromUi(page);
  await advanceTrialToCompleted(member.userId);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "첫 채굴을 마쳤어요.", exact: true }),
  ).toBeVisible();
  await expectNoInitialGuidance(page);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expectNoInitialGuidance(page);

  const freshContext = await browser.newContext({ baseURL });
  try {
    const freshPage = await freshContext.newPage();
    await loginAsMember(freshPage, member, "/start");
    await expectNoInitialGuidance(freshPage);
    await freshContext.addCookies([
      {
        name: E2E_FORCE_REST_FAILURE_COOKIE,
        value:
          "trial_account_snapshots,trial_reward_conversions,member_lifecycle_states",
        url: new URL(freshPage.url()).origin,
      },
    ]);
    await freshPage.reload();
    await expectNoInitialGuidance(freshPage);
  } finally {
    await freshContext.close();
  }
});

test("신규 계정 안내와 완료 계정 안내는 같은 브라우저에서도 분리된다", async ({
  page,
}) => {
  await ensureLocalTrialProgram();
  const completed = await createConfirmedMember("completed-onboarding-switch");
  const first = await createConfirmedMember("first-onboarding-switch");
  await loginAsMember(page, completed, "/start");
  await startTrialFromUi(page);
  await advanceTrialToCompleted(completed.userId);
  await loginAsMember(page, first, "/start");
  await expect(
    page.getByRole("button", { name: "처음 안내 다시 보기", exact: true }),
  ).toBeVisible();
  await loginAsMember(page, completed, "/start");
  await expectNoInitialGuidance(page);
});
