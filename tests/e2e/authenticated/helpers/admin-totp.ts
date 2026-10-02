import { createHmac } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const ADMIN_ORIGIN = `http://127.0.0.1:${process.env.E2E_ADMIN_PORT ?? "3100"}`;
const REMOTE_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  if (value.includes(REMOTE_PROJECT_REF)) {
    throw new Error(`${name} points at the remote Supabase project.`);
  }
  return value;
}

function base32Decode(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secret
    .replace(/=+$/g, "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of cleaned) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("Invalid base32 secret.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

const usedTotpCodes = new Map<string, Set<string>>();

export function rememberTotpUse(secret: string, code: string) {
  const used = usedTotpCodes.get(secret) ?? new Set<string>();
  used.add(code);
  usedTotpCodes.set(secret, used);
}

/** 같은 비밀키에서 아직 쓰지 않은 TOTP가 나올 때까지 기다린다. */
export async function nextTotpCode(secret: string) {
  const started = Date.now();
  while (Date.now() - started < 40_000) {
    const code = generateTotp(secret);
    if (!usedTotpCodes.get(secret)?.has(code)) {
      rememberTotpUse(secret, code);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("TOTP_WINDOW_DID_NOT_ADVANCE");
}

/** RFC 6238 TOTP (SHA-1, 30초, 6자리). 모의 AAL2를 쓰지 않는다. */
export function generateTotp(secret: string, nowMs = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(nowMs / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buffer.writeUInt32BE(counter & 0xffff_ffff, 4);
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function grantAdminRole(userId: string) {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!url.startsWith("http://")) {
    throw new Error("Admin E2E is limited to local Supabase.");
  }
  const service = createClient(url, requiredEnv("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await service.from("user_roles").insert({
    user_id: userId,
    role: "ADMIN",
    granted_by: userId,
  });
  if (error) throw new Error(error.message);
}

async function completeAdminLoginWithTotpOnce(
  page: Page,
  email: string,
  password: string,
): Promise<string> {
  await page.goto(`${ADMIN_ORIGIN}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "보안 로그인" }).click();
  await page.waitForURL(/\/mfa/);

  const secretCode = page.locator(".mfa-enrolment code");
  const retryButton = page.getByRole("button", { name: "다시 확인" });
  try {
    await expect(secretCode.or(retryButton)).toBeVisible({ timeout: 90_000 });
  } catch (error) {
    const note = (await page.locator(".form-note").textContent())?.trim();
    const alert = (await page.locator("[role='alert']").textContent())?.trim();
    throw new Error(
      `TOTP_ENROLMENT_UI_MISSING: note=${note ?? "none"}; alert=${alert ?? "none"}; cause=${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (await retryButton.isVisible()) {
    await retryButton.click();
    await expect(secretCode).toBeVisible({ timeout: 90_000 });
  }
  const secret = (await secretCode.textContent())?.trim();
  if (!secret) throw new Error("TOTP enrolment secret missing.");

  const code = generateTotp(secret);
  rememberTotpUse(secret, code);
  await page.locator('input[inputmode="numeric"]').fill(code);
  await page.getByRole("button", { name: "인증 완료" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/mfa"), {
    timeout: 60_000,
  });
  return secret;
}

export async function completeAdminLoginWithTotp(
  page: Page,
  email: string,
  password: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await completeAdminLoginWithTotpOnce(page, email, password);
    } catch (error) {
      lastError = error;
      if (
        attempt === 2 ||
        !(error instanceof Error) ||
        !error.message.includes("TOTP_ENROLMENT_UI_MISSING")
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

/** 이미 등록된 인증 앱으로 별도 브라우저 세션을 연다. */
export async function completeAdminLoginWithExistingTotp(
  page: Page,
  email: string,
  password: string,
  secret: string,
) {
  await page.goto(`${ADMIN_ORIGIN}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "보안 로그인" }).click();
  await page.waitForURL(/\/mfa/);
  await expect(
    page.getByText("인증 앱에 표시된 6자리 코드를 입력해 주세요."),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".mfa-enrolment code")).toHaveCount(0);
  await page
    .locator('input[inputmode="numeric"]')
    .fill(await nextTotpCode(secret));
  await page.getByRole("button", { name: "인증 완료" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/mfa"), {
    timeout: 60_000,
  });
}
