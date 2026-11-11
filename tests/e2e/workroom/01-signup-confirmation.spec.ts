import { test, expect } from "@playwright/test";
import { identity, invite, sql, opened, required } from "./helpers";

test("real public signup consumes valid invite and confirms through the disposable mailbox", async ({
  page,
}) => {
  const user = identity();
  const code = invite();
  await page.goto("/signup");
  for (const [name, value] of Object.entries({
    referralCode: code,
    legalName: "워크룸검증",
    dateOfBirth: "900115",
    birthSexDigit: "1",
    loginId: user.loginId,
    recoveryEmail: user.email,
    password: user.password,
    passwordConfirmation: user.password,
    phone: user.metadata.phone_e164.replace(/^\+82/, "0"),
  }))
    await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('[name="serviceTermsConsent"]').check();
  await page.locator('[name="privacyConsent"]').check();
  await page.locator('[name="workroomAcknowledged"]').check();
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "입력한 이메일로 확인 안내를 보냈습니다." }),
  ).toBeVisible();
  expect(
    sql(
      `select count(*) from auth.users where email='${user.email}' and email_confirmed_at is null;`,
    ),
  ).toBe("1");
  expect(
    sql(
      `select count(*) from public.user_identity_profiles p join auth.users u on u.id=p.user_id where u.email='${user.email}' and p.date_of_birth='1990-01-15' and p.birth_sex_digit='1';`,
    ),
  ).toBe("1");
  expect(
    sql(`select used from app_private.workroom_invites where code='${code}';`),
  ).toBe("1");
  expect(
    sql(
      `select count(*) from public.member_registration_context c join auth.users u on u.id=c.user_id where u.email='${user.email}' and c.referral_code='${code}' and c.workroom_acknowledged and c.signup_ip is null and c.ip_source='NONE';`,
    ),
  ).toBe("1");
  const mailbox = user.email.split("@")[0]!;
  const mailboxOrigin =
    required("LOCAL_SUPABASE_PROJECT_ID") ===
    "putduk-mining-workroom-local-20261104"
      ? "http://127.0.0.1:64534"
      : "http://127.0.0.1:63424";
  let link = "";
  await expect
    .poll(
      async () => {
        const lookup = await fetch(
          `${mailboxOrigin}/api/v1/search?query=${encodeURIComponent(`to:${user.email}`)}`,
        );
        let body = "";
        if (lookup.ok && lookup.headers.get("content-type")?.includes("json")) {
          // Current Supabase local_smtp uses Mailpit; filter to this exact synthetic recipient.
          const found = (await lookup.json()) as { messages: { ID: string }[] };
          if (!found.messages.length) return false;
          const message = (await fetch(
            `${mailboxOrigin}/api/v1/message/${found.messages[0]!.ID}`,
          ).then((response) => response.json())) as {
            HTML?: string;
            Text?: string;
          };
          body = message.HTML ?? message.Text ?? "";
        } else {
          // Historical pinned CLI distributions use Inbucket. This still reads an actual delivered email.
          const messages = (await fetch(
            `${mailboxOrigin}/api/v1/mailbox/${encodeURIComponent(mailbox)}`,
          ).then((response) => response.json())) as { id: string }[];
          if (!messages.length) return false;
          const message = (await fetch(
            `${mailboxOrigin}/api/v1/mailbox/${encodeURIComponent(mailbox)}/${messages[0]!.id}`,
          ).then((response) => response.json())) as {
            body: { html?: string; text?: string };
          };
          body = message.body.html ?? message.body.text ?? "";
        }
        link =
          body
            .match(/https?:[^"<>\s]+\/auth\/v1\/verify[^"<>\s]*/)?.[0]
            ?.replaceAll("&amp;", "&") ?? "";
        return Boolean(link);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const destination = new URL(link);
  expect(destination.origin).toBe(required("NEXT_PUBLIC_SUPABASE_URL"));
  // Actual GoTrue confirmation; hide single-use confirmation URL from failure reports.
  try {
    await page.goto(link);
  } catch {
    throw new Error("REAL_EMAIL_CONFIRMATION_NAVIGATION_FAILED");
  }
  await expect
    .poll(() =>
      sql(
        `select count(*) from auth.users where email='${user.email}' and email_confirmed_at is not null;`,
      ),
    )
    .toBe("1");
  await page.waitForURL(/\/workroom/);
  const current = await opened(page);
  expect(current.member?.balance).toBe(100000);
  expect(current.ledger.filter((row) => row.kind === "WELCOME")).toHaveLength(
    1,
  );
});
