import { randomInt, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import { execLocalAdminSql } from "./helpers/local-db";

test("reconstructed signup checks real identity availability and submits unchanged consent into local Auth", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const loginId = `signup_${suffix}`;
  const email = `signup-reconstruction.${suffix}@putduk.test`;
  const password = `Local-signup-${suffix}-Aa1`;
  const takenPhone = `010${String(randomInt(100_000_000)).padStart(8, "0")}`;
  const phone = `010${String(randomInt(100_000_000)).padStart(8, "0")}`;
  expect(phone).not.toBe(takenPhone);
  await createConfirmedMember("signup-phone-owner", {
    phoneE164: `+82${takenPhone.slice(1)}`,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signup", { waitUntil: "networkidle" });
  const form = page.getByRole("form", { name: "회원가입", exact: true });
  await form.locator("#signup-legal-name").fill("가입검증 회원");
  await form.locator("#signup-date-of-birth").fill("1990-01-15");
  const identifier = form.locator("#signup-login-id");
  await identifier.fill(loginId);
  await identifier
    .locator("..")
    .getByRole("button", { name: "사용 가능 확인", exact: true })
    .click();
  await expect(form.locator("#login-id-status")).toHaveText(
    "사용할 수 있는 아이디예요.",
  );
  await form.locator("#signup-recovery-email").fill(email);
  await form.locator("#signup-password").fill(password);
  await form.locator("#signup-password-confirmation").fill(password);
  const phoneInput = form.locator("#signup-phone");
  const checkPhone = phoneInput
    .locator("..")
    .getByRole("button", { name: "사용 가능 확인", exact: true });
  await phoneInput.fill(takenPhone);
  await checkPhone.click();
  await expect(form.locator("#phone-status")).toHaveText(
    "이미 사용된 번호예요.",
  );
  await expect(phoneInput).toHaveAttribute("aria-invalid", "true");
  await phoneInput.fill(phone);
  await checkPhone.click();
  await expect(form.locator("#phone-status")).toHaveText(
    "사용할 수 있는 번호예요.",
  );
  await expect(phoneInput).toHaveAttribute("aria-invalid", "false");
  await form.locator("#consent-service").check();
  await form.locator("#consent-privacy").check();
  await expect(form.locator("#consent-marketing")).not.toBeChecked();
  await form
    .getByRole("button", { name: "가입하고 시작하기", exact: true })
    .click();
  await expect(
    form
      .getByRole("status")
      .filter({ hasText: "입력한 이메일로 확인 안내를 보냈습니다." }),
  ).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/signup");
  // This user must be produced by the public server action, not an admin
  // fixture. Local email confirmation remains mandatory and creates no money.
  const evidence = JSON.parse(
    execLocalAdminSql(
      `select jsonb_build_object(
      'count',(select count(*) from auth.users where email=:'email'),
      'confirmed',(select email_confirmed_at is not null from auth.users where email=:'email'),
      'metadata',(select raw_user_meta_data from auth.users where email=:'email'),
      'ledgerCount',(select count(*) from public.ledger_transactions l join auth.users u on u.id=l.member_user_id where u.email=:'email')
    );`,
      { email },
    ),
  );
  expect(evidence.count).toBe(1);
  expect(evidence.confirmed).toBe(false);
  expect(evidence.ledgerCount).toBe(0);
  expect(evidence.metadata).toMatchObject({
    signup_source: "PUBLIC_V1",
    login_id: loginId,
    legal_name: "가입검증 회원",
    date_of_birth: "1990-01-15",
    phone_e164: `+82${phone.slice(1)}`,
    recovery_email: email,
    service_terms_granted: true,
    privacy_granted: true,
    marketing_granted: false,
  });
  const denied = await createLocalServiceRoleClient().auth.signInWithPassword({
    email,
    password,
  });
  expect(denied.error?.code).toBe("email_not_confirmed");
  expect(denied.data.session).toBeNull();
});
