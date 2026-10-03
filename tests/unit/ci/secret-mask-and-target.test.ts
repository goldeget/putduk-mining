import { describe, expect, it } from "vitest";

import {
  assertCiTestTarget,
  blankLiveProviderAssignments,
  loadJobLocalAllowlist,
} from "../../../scripts/capture-local-supabase-env.mjs";
import { prepareLocalAuthenticatedEnv } from "../../../scripts/run-local-authenticated-e2e.mjs";
import { prepareWithdrawalProductEnv } from "../../../scripts/run-withdrawal-product-e2e.mjs";
import {
  assertProtectedRuntime,
  protectedChildEnv,
  scrubSecrets,
} from "../../../scripts/typography-protected-servers.mjs";
import { recordWithdrawalDataKey } from "../../../scripts/write-ephemeral-withdrawal-key.mjs";

const allow = loadJobLocalAllowlist();
const LOCAL_URL = `http://127.0.0.1:${allow.apiPort}`;
const PUBLISHABLE = "sb_publishable_local_fixture";
const SECRET = "sb_secret_local_fixture";
const LOCAL_DB = `postgresql://postgres:unit-test-password@127.0.0.1:${allow.dbPort}/postgres`;
const FIXTURE_KEY = Buffer.from("a".repeat(32)).toString("base64");
const LOCAL = {
  apiUrl: LOCAL_URL,
  publishableKey: PUBLISHABLE,
  secretKey: SECRET,
  dbUrl: LOCAL_DB,
};

describe("CI secret mask and target allowlist", () => {
  it("registers the withdrawal mask before the env write and does not echo it", () => {
    const stdout: string[] = [];
    const envWrites: string[] = [];
    recordWithdrawalDataKey({
      key: FIXTURE_KEY,
      writeStdout: (line) => stdout.push(line),
      writeEnv: (line) => envWrites.push(line),
    });
    expect(stdout).toEqual([`::add-mask::${FIXTURE_KEY}\n`]);
    expect(envWrites).toEqual([`WITHDRAWAL_DATA_KEY=${FIXTURE_KEY}\n`]);
    expect(stdout.join("")).not.toContain("echo");
  });

  it("does not write the env file when the key is unsafe", () => {
    const envWrites: string[] = [];
    expect(() =>
      recordWithdrawalDataKey({
        key: `${FIXTURE_KEY}\n`,
        writeStdout: () => {},
        writeEnv: (line) => envWrites.push(line),
      }),
    ).toThrow(/generation failed/);
    expect(envWrites).toEqual([]);
  });

  it("rejects production and hosted targets instead of a string prefix", () => {
    expect(() => assertCiTestTarget({ APP_ENV: "production" })).toThrow(
      /PRODUCTION_ENV_REJECTED/,
    );
    expect(() => assertCiTestTarget({ APP_ENV: "staging" })).toThrow(
      /PRODUCTION_ENV_REJECTED/,
    );
    expect(() =>
      assertCiTestTarget({ SUPABASE_PROJECT_REF: "osrmyjgmpdspdcwqjwuv" }),
    ).toThrow(/REMOTE_SUPABASE_SECRET_REJECTED/);
    expect(() =>
      assertCiTestTarget({
        NEXT_PUBLIC_SUPABASE_URL: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
      }),
    ).toThrow(/Refusing remote Supabase credentials/);
    expect(() =>
      assertCiTestTarget({
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1.evil.com:${allow.apiPort}`,
      }),
    ).toThrow(/127\.0\.0\.1 and localhost/);
    expect(() => assertCiTestTarget({ APP_ENV: "test" })).not.toThrow();
  });

  it("blanks live provider names without copying their values", () => {
    const assignments = blankLiveProviderAssignments();
    expect(assignments).toContain("AI_API_KEY=\n");
    expect(assignments).toContain("VAPID_PRIVATE_KEY=\n");
    expect(assignments).not.toContain("fixture-live");
  });

  it("keeps authenticated runners on the local test transport", () => {
    const previous = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = "true";
    const stdout: string[] = [];
    try {
      const env = prepareLocalAuthenticatedEnv({
        baseEnv: {
          APP_ENV: "development",
          AI_API_KEY: "fixture-live-ai-key-value",
          RESEND_API_KEY: "fixture-live-mail-key",
        },
        local: LOCAL,
        projectId: allow.projectId,
        withdrawalKey: FIXTURE_KEY,
        webPort: "3451",
        adminPort: "3452",
        writeStdout: (line) => stdout.push(line),
      });
      expect(env.APP_ENV).toBe("test");
      expect(env.AI_API_KEY).toBeUndefined();
      expect(env.RESEND_API_KEY).toBeUndefined();
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(LOCAL_URL);
      expect(env.WITHDRAWAL_DATA_KEY).toBe(FIXTURE_KEY);
      expect(stdout.every((line) => line.startsWith("::add-mask::"))).toBe(
        true,
      );
      expect(stdout).toContain(`::add-mask::${FIXTURE_KEY}\n`);
      expect(stdout).toContain(`::add-mask::${SECRET}\n`);
      expect(stdout.join("")).not.toContain("echo");
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_ACTIONS;
      } else {
        process.env.GITHUB_ACTIONS = previous;
      }
    }
  });

  it("rejects an injected production env before building the withdrawal child", () => {
    expect(() =>
      prepareWithdrawalProductEnv({
        baseEnv: { APP_ENV: "production" },
        local: LOCAL,
        withdrawalKey: FIXTURE_KEY,
      }),
    ).toThrow(/PRODUCTION_ENV_REJECTED/);
  });

  it("scrubs child logs and refuses a protected server on a remote URL", () => {
    expect(scrubSecrets(`before ${SECRET} after`, [SECRET])).toBe(
      "before [redacted] after",
    );
    expect(scrubSecrets("postgres stays", ["postgres"])).toBe("postgres stays");
    expect(() =>
      assertProtectedRuntime({
        APP_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
        SUPABASE_SECRET_KEY: SECRET,
        WITHDRAWAL_DATA_KEY: FIXTURE_KEY,
      }),
    ).toThrow(/Refusing remote Supabase credentials/);
    const child = protectedChildEnv(
      {
        APP_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
        SUPABASE_SECRET_KEY: SECRET,
        WITHDRAWAL_DATA_KEY: FIXTURE_KEY,
        SMTP_PASSWORD: "fixture-live-smtp",
      },
      { NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000" },
    );
    expect(child.APP_ENV).toBe("test");
    expect(child.NEXT_PUBLIC_APP_ENV).toBe("test");
    expect(child.SMTP_PASSWORD).toBeUndefined();
    expect(child.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3000");
  });
});
