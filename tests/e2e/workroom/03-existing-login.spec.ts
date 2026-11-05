import { test, expect } from "@playwright/test";
import { required, login, state, sql } from "./helpers";
test("precutover member signs in without registering again and retains identity", async ({
  page,
}) => {
  const user = {
    email: required("WORKROOM_EXISTING_EMAIL"),
    password: required("WORKROOM_EXISTING_PASSWORD"),
  };
  const id = required("WORKROOM_EXISTING_ID");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  const before = sql("select count(*) from auth.users;");
  await login(page, user);
  const openWorkroom = page.getByRole("button", {
    name: "내 워크룸 개설",
    exact: true,
  });
  if (await openWorkroom.isVisible()) await openWorkroom.click();
  await expect(
    page.getByRole("heading", { name: /모니터링 시작하기|이번 모의 참여/ }),
  ).toBeVisible();
  const current = await state(page);
  expect(current.member?.id).toBe(id);
  await page.reload();
  expect((await state(page)).member?.id).toBe(id);
  expect(sql("select count(*) from auth.users;")).toBe(before);
  expect(
    sql(
      `select count(*) from app_private.workroom_ledger where user_id='${id}' and kind='WELCOME';`,
    ),
  ).toBe("1");
});
