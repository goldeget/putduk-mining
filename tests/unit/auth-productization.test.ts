import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

async function source(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("public auth productization boundaries", () => {
  it("binds password-update entry to a server-verified recovery flow", async () => {
    const [callback, confirm, proof, action] = await Promise.all([
      source("app/auth/callback/route.ts"),
      source("app/auth/confirm/route.ts"),
      source("app/auth/update-password/recovery-proof.ts"),
      source("app/auth/update-password/actions.ts"),
    ]);

    expect(callback).toContain('event === "PASSWORD_RECOVERY"');
    expect(callback).toContain("const isRecovery = recoveryEventObserved");
    expect(confirm).toContain(
      'const isRecovery = requestedType === "recovery"',
    );
    expect(proof).toContain("payload.sessionId === sessionId");
    expect(proof).toContain("timingSafeEqual(expected, supplied)");
    expect(action).toContain('path: "/auth/update-password"');
    expect(action).toContain("maxAge: 0");
    expect(action).toContain('scope: "global"');
  });

  it("keeps recovery and ID-help responses account-enumeration resistant", async () => {
    const [recovery, findId, login] = await Promise.all([
      source("app/recover/actions.ts"),
      source("app/find-id/actions.ts"),
      source("app/login/actions.ts"),
    ]);

    expect(recovery).toContain(
      "입력한 정보와 일치하는 계정이 있으면 비밀번호 재설정 안내를 보냈습니다.",
    );
    expect(findId).toContain(
      "입력한 정보와 일치하는 계정이 있으면 아이디 확인 링크를 보냈습니다.",
    );
    expect(login).toContain("crypto.randomUUID()");
    expect(login).toContain("로그인 정보를 확인해 주세요.");
    expect(login).not.toContain("AUTH_USER_NOT_FOUND");
  });

  it("keeps privileged identity functions server-only and consent evidence append-only", async () => {
    const migration = await source(
      "supabase/migrations/20260927003000_identity_consent_productization.sql",
    );

    expect(migration).toContain("PUBLIC_SIGNUP_PROFILE_REQUIRED");
    expect(migration).toContain("UNAPPROVED_CONSENT_VERSION");
    expect(migration).toContain("perform public.bootstrap_user(new.id)");
    expect(migration).toContain(
      "unique (user_id, consent_key, consent_version, request_id)",
    );
    expect(migration).toMatch(
      /grant execute on function public\.is_login_id_available\(text\)[\s\S]*?to service_role;/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.is_login_id_available\(text\)[\s\S]*?to (?:anon|authenticated)/,
    );
    expect(migration).not.toMatch(/auth\.jwt\(\)[\s\S]*user_meta_data/);
  });

  it("exposes stable accessible selectors for critical auth E2E journeys", async () => {
    const [loginForm, signupForm, recoveryForm, findIdForm, passwordForm] =
      await Promise.all([
        source("app/login/auth-form.tsx"),
        source("app/signup/signup-form.tsx"),
        source("app/recover/recovery-form.tsx"),
        source("app/find-id/find-id-form.tsx"),
        source("app/auth/update-password/update-password-form.tsx"),
      ]);

    expect(loginForm).toContain('id="login-identifier"');
    expect(loginForm).toContain('id="login-password"');
    expect(signupForm).toContain('id="signup-login-id"');
    expect(signupForm).toContain('id="consent-service"');
    expect(signupForm).toContain('id="consent-privacy"');
    expect(recoveryForm).toContain('id="recovery-email"');
    expect(findIdForm).toContain('id="find-id-email"');
    expect(passwordForm).toContain('id="new-password"');
    expect(passwordForm).toContain('id="password-confirmation"');
  });
});
