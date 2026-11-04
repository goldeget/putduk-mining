import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { WorkroomState } from "../../../domain/workroom/contracts";
import { nextTotpCode } from "../authenticated/helpers/admin-totp";

export const adminOrigin = `http://${process.env.E2E_ADMIN_HOST ?? "localhost"}:${process.env.E2E_ADMIN_PORT ?? "3100"}`;
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`WORKROOM_ENV_REQUIRED:${name}`);
  return value;
}
export function localGuard() {
  const targets: Record<string, string> = {
    "putduk-mining-ci-r2-20261009": "http://127.0.0.1:63421",
    "putduk-mining-workroom-local-20261104": "http://127.0.0.1:64531",
  };
  if (
    process.env.APP_ENV !== "test" ||
    required("NEXT_PUBLIC_SUPABASE_URL") !==
      targets[required("LOCAL_SUPABASE_PROJECT_ID")]
  )
    throw new Error("WORKROOM_LOCAL_TARGET_REQUIRED");
}
export function sql(statement: string): string {
  localGuard();
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${required("LOCAL_SUPABASE_PROJECT_ID")}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "--set",
      "ON_ERROR_STOP=1",
    ],
    {
      input: statement,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    },
  ).trim();
}
export function service() {
  localGuard();
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SECRET_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, options) =>
          fetch(input, { ...options, signal: AbortSignal.timeout(30_000) }),
      },
    },
  );
}
export function auth() {
  localGuard();
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, options) =>
          fetch(input, { ...options, signal: AbortSignal.timeout(30_000) }),
      },
    },
  );
}
export function invite() {
  const code = `WR-${randomUUID().replaceAll("-", "").toUpperCase()}`;
  sql(
    `insert into app_private.workroom_invites(code,max_uses,expires_at) values('${code}',1,clock_timestamp()+interval '1 hour');`,
  );
  return code;
}
export function identity() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 13);
  const email = `workroom.${suffix}@putduk.test`;
  return {
    email,
    password: `Workroom-${suffix}-Aa1!`,
    loginId: `w${suffix}`,
    metadata: {
      signup_source: "PUBLIC_V1",
      legal_name: "워크룸검증",
      login_id: `w${suffix}`,
      date_of_birth: "1990-01-15",
      phone_e164: `+8210${BigInt(`0x${suffix}`).toString().slice(-8)}`,
      recovery_email: email,
      service_terms_version: "TERMS-KO-2026-09-27",
      privacy_version: "PRIVACY-KO-2026-09-27",
      marketing_version: "MARKETING-KO-2026-09-27",
      service_terms_granted: true,
      privacy_granted: true,
      marketing_granted: false,
      workroomAcknowledged: true,
    },
  };
}
export async function member() {
  const user = identity();
  const result = await service().auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { ...user.metadata, referralCode: invite() },
  });
  if (result.error || !result.data.user)
    throw new Error("VALID_INVITE_AUTH_FIXTURE_FAILED");
  return { ...user, userId: result.data.user.id };
}
export async function login(
  page: Page,
  user: { email: string; password: string },
) {
  await page.goto("/login?next=%2Fworkroom");
  await page.locator('[name="identifier"]').fill(user.email);
  await page.locator('[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/workroom/);
  await expect(
    page.getByRole("heading", {
      name: /나만의 워크룸을 개설하세요|모니터링 시작하기|이번 모의 참여/,
    }),
  ).toBeVisible();
}
export async function state(page: Page): Promise<WorkroomState> {
  const response = await page.request.get("/api/v1/workroom/state");
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
export async function command(
  page: Page,
  operation: string,
  input: unknown = {},
  key: string = randomUUID(),
) {
  return page.request.post("/api/v1/workroom/command", {
    headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": key },
    data: { operation, input },
  });
}
export async function opened(page: Page) {
  const response = await command(page, "OPEN");
  expect(response.status()).toBe(200);
  return (await response.json()).data as WorkroomState;
}
export async function started(page: Page, key: string = randomUUID()) {
  const before = await opened(page);
  const config = before.configs.find((row) => row.instrument === "usd")!;
  const input = {
    instrument: "usd",
    stake: 1000,
    acknowledged: true,
    expectedVersion: config.version,
  };
  const response = await command(page, "START", input, key);
  expect(response.status()).toBe(200);
  return { state: (await response.json()).data as WorkroomState, input, key };
}
export async function operator() {
  const user = await member();
  const client = service();
  const result = await client
    .from("user_roles")
    .insert({ user_id: user.userId, role: "ADMIN", granted_by: user.userId });
  if (result.error) throw new Error("DISPOSABLE_OPERATOR_ROLE_FAILED");
  return user;
}
export async function adminCommand(
  page: Page,
  operation: string,
  input: unknown,
  key: string = randomUUID(),
) {
  return adminRequest(page, "POST", "/api/v1/admin/workroom/command", {
    headers: { "Idempotency-Key": key },
    data: { operation, input },
  });
}
export async function adminState(page: Page) {
  const response = await adminRequest(
    page,
    "GET",
    "/api/v1/admin/workroom/state",
  );
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
export async function adminRequest(
  page: Page,
  method: "GET" | "POST",
  path: string,
  options: { headers?: Record<string, string>; data?: unknown } = {},
) {
  if (new URL(page.url()).origin !== adminOrigin)
    throw new Error("WORKROOM_ADMIN_BROWSER_ORIGIN_REQUIRED");
  const url = new URL(path, adminOrigin).toString();
  const response = await page.evaluate(
    async ({ url, method, headers, data }) => {
      const result = await fetch(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: result.status, body: await result.text() };
    },
    { url, method, headers: options.headers ?? {}, data: options.data },
  );
  return {
    status: () => response.status,
    json: async () => JSON.parse(response.body),
  };
}
export async function adminLogin(
  page: Page,
  user: { email: string; password: string },
) {
  await page.goto(`${adminOrigin}/login`);
  await page.locator('[name="email"]').fill(user.email);
  await page.locator('[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "보안 로그인" }).click();
  await page.waitForURL(/\/mfa/);
  // Before real TOTP verification the app must reject the very API being accepted.
  expect(
    (await adminRequest(page, "GET", "/api/v1/admin/workroom/state")).status(),
  ).toBe(403);
  const secretNode = page.locator(".mfa-enrolment code");
  await expect(secretNode).toBeVisible({ timeout: 60_000 });
  const secret = (await secretNode.textContent())!.trim();
  await page
    .locator('input[inputmode="numeric"]')
    .fill(await nextTotpCode(secret));
  await page.getByRole("button", { name: "인증 완료" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/mfa"));
  await adminState(page);
  // Never persist the TOTP secret, Auth JWT, cookies or password in evidence.
}
