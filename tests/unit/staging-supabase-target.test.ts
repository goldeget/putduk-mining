import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicEnv, parseSupabaseBrowserAuthConfig } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAdminEnv } from "../../apps/admin/lib/env";
import targetManifest from "@/lib/env/staging-target.json";

const clients = vi.hoisted(() => ({ create: vi.fn(), browser: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: clients.create }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: clients.browser }));

const parent = "https://osrmyjgmpdspdcwqjwuv.supabase.co";
const branch = "https://mhchzipznxbwbocdihlg.supabase.co";
const memberOrigin =
  "https://putduk-mining-member-staging-ab1de38.putduk-landing.workers.dev";
const adminOrigin =
  "https://putduk-mining-admin-staging-ab1de38.putduk-landing.workers.dev";
const publicKey = "sb_publishable_staging_public_fixture";
const secretKey = "sb_secret_staging_private_fixture";
const legacy = (role: string, ref: string) => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, ref })}.fixture`;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
  for (const name of [
    "AI_PROVIDER",
    "AI_API_KEY",
    "NVIDIA_API_KEY",
    "AI_MODEL_LOW_COST",
    "AI_MODEL_HIGH_CAPABILITY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ])
    vi.stubEnv(name, undefined);
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
  vi.stubEnv("APP_TIMEZONE", "UTC");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", memberOrigin);
  vi.stubEnv("ADMIN_APP_URL", adminOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", branch);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publicKey);
  vi.stubEnv("SUPABASE_SECRET_KEY", secretKey);
  clients.create.mockReset();
  clients.browser.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("immutable hosted staging Supabase target", () => {
  it.each([
    "https://mining.putduk.com",
    adminOrigin,
    `${memberOrigin}/other`,
    `${memberOrigin}?other=1`,
    "http://127.0.0.1:3000",
  ])("rejects an unreviewed or swapped member app origin", (url) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", url);
    expect(() => getPublicEnv()).toThrow();
    expect(() => createSupabaseAdminClient()).toThrow();
    expect(clients.create).not.toHaveBeenCalled();
  });

  it.each([
    "https://admin.mining.putduk.com",
    memberOrigin,
    `${adminOrigin}/other`,
    `${adminOrigin}#other`,
    "http://127.0.0.1:3100",
  ])("rejects an unreviewed or swapped admin app origin", (url) => {
    vi.stubEnv("ADMIN_APP_URL", url);
    expect(() => getAdminEnv()).toThrow();
  });

  it("does not let a mutable JSON import redirect the admitted target at runtime", () => {
    const original = { ...targetManifest };
    try {
      Object.assign(targetManifest, {
        projectRef: "aaaaaaaaaaaaaaaaaaaa",
        apiOrigin: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      });
      expect(
        parseSupabaseBrowserAuthConfig({
          url: branch,
          publishableKey: publicKey,
        }).url,
      ).toBe(branch);
      expect(() =>
        parseSupabaseBrowserAuthConfig({
          url: targetManifest.apiOrigin,
          publishableKey: publicKey,
        }),
      ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
    } finally {
      Object.assign(targetManifest, original);
    }
  });

  it("admits the one reviewed branch in a staging browser build and both server envs", () => {
    expect(
      parseSupabaseBrowserAuthConfig({
        url: branch,
        publishableKey: publicKey,
      }),
    ).toEqual({ url: branch, publishableKey: publicKey });
    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(branch);
    expect(getServerEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(branch);
    expect(getAdminEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(branch);
    createSupabaseBrowserClient({ url: branch, publishableKey: publicKey });
    expect(clients.browser).toHaveBeenCalledExactlyOnceWith(branch, publicKey);
  });

  it.each([
    parent,
    "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    "http://127.0.0.1:63421",
    `${branch}:444`,
    `${branch}/auth`,
    `${branch}?x=1`,
    `${branch}#x`,
    "https://user:secret@mhchzipznxbwbocdihlg.supabase.co",
  ])("rejects unapproved staging targets in browser and server: %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    expect(() =>
      parseSupabaseBrowserAuthConfig({ url, publishableKey: publicKey }),
    ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
    expect(() => getPublicEnv()).toThrow();
    expect(() => getAdminEnv()).toThrow();
    expect(() => createSupabaseAdminClient()).toThrow();
    expect(clients.create).not.toHaveBeenCalled();
    expect(() =>
      createSupabaseBrowserClient({ url, publishableKey: publicKey }),
    ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
    expect(clients.browser).not.toHaveBeenCalled();
  });

  it.each([undefined, "production", "test"])(
    "rejects server staging when compiled public mode is %s",
    (mode) => {
      vi.stubEnv("NEXT_PUBLIC_APP_ENV", mode);
      expect(() => getPublicEnv()).toThrow();
      expect(() => getAdminEnv()).toThrow();
    },
  );

  it.each([undefined, "production", "test"])(
    "rejects a staging build running in server mode %s",
    (mode) => {
      vi.stubEnv("APP_ENV", mode);
      expect(() => getPublicEnv()).toThrow();
      expect(() => getAdminEnv()).toThrow();
    },
  );

  it("expires both server client paths at the fixed deadline without treating the browser clock as authority", () => {
    vi.setSystemTime(new Date("2026-10-23T09:51:53Z"));
    expect(() => getPublicEnv()).toThrow();
    expect(() => getAdminEnv()).toThrow();
    expect(() => createSupabaseAdminClient()).toThrow();
    expect(clients.create).not.toHaveBeenCalled();
    expect(
      parseSupabaseBrowserAuthConfig({ url: branch, publishableKey: publicKey })
        .url,
    ).toBe(branch);
  });

  it.each([
    secretKey,
    legacy("service_role", "mhchzipznxbwbocdihlg"),
    legacy("anon", "osrmyjgmpdspdcwqjwuv"),
  ])("never serializes a private or foreign legacy public key", (key) => {
    expect(() =>
      parseSupabaseBrowserAuthConfig({ url: branch, publishableKey: key }),
    ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
  });

  it("rejects a parent legacy service key before either privileged client path", () => {
    vi.stubEnv(
      "SUPABASE_SECRET_KEY",
      legacy("service_role", "osrmyjgmpdspdcwqjwuv"),
    );
    expect(() => getServerEnv()).toThrow();
    expect(() => getAdminEnv()).toThrow();
    expect(() => createSupabaseAdminClient()).toThrow();
    expect(clients.create).not.toHaveBeenCalled();
  });

  it("accepts branch-bound legacy anon/service credentials without leaking the service key to client props", () => {
    const publishableKey = legacy("anon", "mhchzipznxbwbocdihlg");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey);
    vi.stubEnv(
      "SUPABASE_SECRET_KEY",
      legacy("service_role", "mhchzipznxbwbocdihlg"),
    );
    expect(getServerEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(branch);
    expect(
      Object.keys(
        parseSupabaseBrowserAuthConfig({ url: branch, publishableKey }),
      ),
    ).toEqual(["url", "publishableKey"]);
  });

  it("retains the production host pin and rejects the branch for a non-staging build", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", parent);
    expect(
      parseSupabaseBrowserAuthConfig({ url: parent, publishableKey: publicKey })
        .url,
    ).toBe(parent);
    expect(() =>
      parseSupabaseBrowserAuthConfig({
        url: branch,
        publishableKey: publicKey,
      }),
    ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(parent);
  });

  it.each([
    null,
    { parentProjectRef: "aaaaaaaaaaaaaaaaaaaa" },
    { projectRef: "invalid" },
    { apiOrigin: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co" },
    { branchId: "unknown" },
    { expiresAt: "not-a-time" },
  ])(
    "fails closed if the reviewed manifest is missing or malformed",
    async (change) => {
      const admitted = {
        version: 1,
        purpose: "protected-staging",
        parentProjectRef: "osrmyjgmpdspdcwqjwuv",
        projectRef: "mhchzipznxbwbocdihlg",
        branchId: "86e7d936-3a16-4b38-9410-a7c2bcb401c0",
        apiOrigin: branch,
        memberOrigin,
        adminOrigin,
        expiresAt: "2026-10-23T09:51:53Z",
      };
      vi.doMock("@/lib/env/staging-target.json", () => ({
        default: change === null ? null : { ...admitted, ...change },
      }));
      vi.resetModules();
      try {
        const current = await import("@/lib/env/public");
        expect(() =>
          current.parseSupabaseBrowserAuthConfig({
            url: branch,
            publishableKey: publicKey,
          }),
        ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
        expect(() => current.getPublicEnv()).toThrow();
      } finally {
        vi.doUnmock("@/lib/env/staging-target.json");
        vi.resetModules();
      }
    },
  );

  it.each([
    publicKey,
    legacy("anon", "mhchzipznxbwbocdihlg"),
    legacy("service_role", ""),
  ])(
    "rejects public or unbound legacy credentials as a staging server secret",
    (key) => {
      vi.stubEnv("SUPABASE_SECRET_KEY", key);
      expect(() => getServerEnv()).toThrow("STAGING_SERVER_KEY_REJECTED");
      expect(() => getAdminEnv()).toThrow("STAGING_SERVER_KEY_REJECTED");
      expect(() => createSupabaseAdminClient()).toThrow();
      expect(clients.create).not.toHaveBeenCalled();
    },
  );
});
