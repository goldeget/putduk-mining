import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicEnv, parseSupabaseBrowserAuthConfig } from "@/lib/env/public";
import { getSupabaseBrowserAuthConfig } from "@/lib/env/supabase-browser.server";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createBrowserClient } from "@supabase/ssr";
import { loadJobLocalAllowlist } from "../../scripts/capture-local-supabase-env.mjs";
import * as localSupabaseEnv from "../../scripts/capture-local-supabase-env.mjs";

vi.mock("@supabase/ssr", () => ({ createBrowserClient: vi.fn() }));

const remoteUrl = "https://osrmyjgmpdspdcwqjwuv.supabase.co";
const localUrl = `http://127.0.0.1:${loadJobLocalAllowlist().apiPort}`;
const publishableKey = "sb_publishable_runtime_public_fixture";

function legacyKey(role: string) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.fixture`;
}

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("PUTDUK_LOCAL_SUPABASE_CONFIG_PATH", undefined);
  vi.stubEnv("PUTDUK_WORKERD_LOCAL_AUTH_SCOPE", undefined);
  vi.stubEnv("PUTDUK_WORKERD_LOCAL_ALLOWLIST", undefined);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", localUrl);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_must_stay_on_server_fixture");
  vi.stubEnv("AI_API_KEY", "provider_secret_must_stay_on_server_fixture");
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-vapid-fixture-key");
  vi.stubEnv("NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY", "public-support-fixture");
  vi.mocked(createBrowserClient).mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("public Supabase runtime configuration", () => {
  it("reads each runtime's public tuple and serializes only URL and publishable key", () => {
    const localConfig = getSupabaseBrowserAuthConfig();
    expect(localConfig).toEqual({ url: localUrl, publishableKey });
    expect(Object.keys(localConfig)).toEqual(["url", "publishableKey"]);
    expect(JSON.stringify(localConfig)).not.toMatch(
      /secret|VAPID|CHANNEL|APP_URL/,
    );

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", remoteUrl);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      `${publishableKey}_changed`,
    );
    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(remoteUrl);
    expect(getSupabaseBrowserAuthConfig()).toEqual({
      url: remoteUrl,
      publishableKey: `${publishableKey}_changed`,
    });
  });

  it("keeps browser initialization independent of missing build-time app/env values", () => {
    const config = getSupabaseBrowserAuthConfig();
    for (const name of [
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    ])
      vi.stubEnv(name, undefined);
    const browserClient = { auth: { onAuthStateChange: vi.fn() } };
    vi.mocked(createBrowserClient).mockReturnValue(
      browserClient as unknown as ReturnType<typeof createBrowserClient>,
    );
    expect(createSupabaseBrowserClient(config)).toBe(browserClient);
    expect(createBrowserClient).toHaveBeenCalledExactlyOnceWith(
      config.url,
      config.publishableKey,
    );
  });

  it.each([
    "https://different-project.supabase.co",
    "https://osrmyjgmpdspdcwqjwuv.supabase.co.evil.invalid",
    "https://user:password@osrmyjgmpdspdcwqjwuv.supabase.co",
    `${remoteUrl}/unapproved-path`,
    `${remoteUrl}?target=another`,
    `${remoteUrl}#fragment`,
    "http://127.0.0.1.evil.invalid:58421",
  ])(
    "rejects an unexpected or ambiguous target before browser client creation: %s",
    (url) => {
      expect(() =>
        createSupabaseBrowserClient({ url, publishableKey }),
      ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
      expect(createBrowserClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    "sb_secret_must_never_be_serialized_fixture",
    legacyKey("service_role"),
    legacyKey("authenticated"),
    "arbitrary-key-with-a-long-enough-length",
  ])(
    "rejects secret and non-public keys without including the value in an error",
    (key) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
      expect(() =>
        createSupabaseBrowserClient({ url: remoteUrl, publishableKey: key }),
      ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
      expect(createBrowserClient).not.toHaveBeenCalled();
    },
  );

  it("accepts legacy anon keys for the isolated local Supabase auth client", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", legacyKey("anon"));
    expect(getSupabaseBrowserAuthConfig().publishableKey).toBe(
      legacyKey("anon"),
    );
  });

  it("rejects a full environment object at the client boundary", () => {
    expect(() =>
      parseSupabaseBrowserAuthConfig({
        url: remoteUrl,
        publishableKey,
        SUPABASE_SECRET_KEY: "sb_secret_never_forward_environment_objects",
      }),
    ).toThrow("SUPABASE_BROWSER_CONFIG_INVALID");
  });

  it("checks the local checkout's API port and environment before serialization", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
    expect(() => getSupabaseBrowserAuthConfig()).toThrow(
      "SUPABASE_BROWSER_CONFIG_INVALID",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", localUrl);
    vi.stubEnv("APP_ENV", "production");
    expect(() => getSupabaseBrowserAuthConfig()).toThrow(
      "SUPABASE_BROWSER_CONFIG_INVALID",
    );
  });
});

describe("browser config task runtime selection", () => {
  it("uses source-root config from admin cwd and preserves public-only tuple", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const task = createOwnedTask(root, "browser-config-");
    const cwd = vi.spyOn(process, "cwd");
    try {
      mkdirSync(join(task, "supabase"));
      const path = join(task, "supabase/config.toml");
      writeFileSync(
        path,
        'project_id = "putduk-mining-browser-unit"\n[api]\nport = 65131\n[db]\nport = 65132\n',
      );
      vi.stubEnv("PUTDUK_LOCAL_SUPABASE_CONFIG_PATH", path);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:65131");
      cwd.mockReturnValue(join(root, "apps/admin"));
      expect(getSupabaseBrowserAuthConfig()).toEqual({
        url: "http://127.0.0.1:65131",
        publishableKey,
      });
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", localUrl);
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:65131");
      vi.stubEnv(
        "PUTDUK_LOCAL_SUPABASE_CONFIG_PATH",
        join(root, "supabase/config.toml"),
      );
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", remoteUrl);
      vi.stubEnv("APP_ENV", "production");
      expect(getSupabaseBrowserAuthConfig()).toEqual({
        url: remoteUrl,
        publishableKey,
      });
    } finally {
      cwd.mockRestore();
      removeOwnedTask(task, root);
    }
  });
});

function createOwnedTask(root: string, prefix: string) {
  const task = join(root, `.next-qa-${prefix}${randomUUID()}`);
  mkdirSync(task); // Exclusive creation; never overwrite a pre-existing path.
  return task;
}
function removeOwnedTask(task: string, root: string) {
  const at = realpathSync(task);
  const rel = relative(realpathSync(root), at);
  if (
    isAbsolute(rel) ||
    !/^\.next-qa-[a-z0-9-]{1,64}$/.test(rel) ||
    at !== resolve(task)
  )
    throw new Error("UNIT_TEMP_DELETE_SCOPE_REJECTED");
  rmSync(at, { recursive: true });
}

describe("admitted CI workerd browser configuration", () => {
  const allowlist = loadJobLocalAllowlist();
  const admit = () => {
    vi.stubEnv("PUTDUK_WORKERD_LOCAL_AUTH_SCOPE", "ci-auth-v1");
    vi.stubEnv("PUTDUK_WORKERD_LOCAL_ALLOWLIST", JSON.stringify(allowlist));
  };

  it("uses the independently admitted allowlist without checkout filesystem reads", () => {
    admit();
    const read = vi
      .spyOn(localSupabaseEnv, "loadJobLocalAllowlist")
      .mockImplementation(() => {
        throw new Error("QA_CHECKOUT_FILESYSTEM_UNAVAILABLE");
      });
    try {
      expect(getSupabaseBrowserAuthConfig()).toEqual({
        url: localUrl,
        publishableKey,
      });
      expect(Object.keys(getSupabaseBrowserAuthConfig())).toEqual([
        "url",
        "publishableKey",
      ]);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it.each([
    undefined,
    "not-json",
    "[]",
    JSON.stringify({ ...allowlist, projectId: "putduk-mining-other" }),
    JSON.stringify({ ...allowlist, extra: "not-admitted" }),
    JSON.stringify({ ...allowlist, apiPort: "0" }),
    JSON.stringify({ ...allowlist, apiPort: "063421" }),
    JSON.stringify({ ...allowlist, apiPort: "65536" }),
    JSON.stringify({ ...allowlist, apiPort: 63421 }),
    JSON.stringify({ ...allowlist, dbPort: "-1" }),
    JSON.stringify({
      projectId: allowlist.projectId,
      apiPort: allowlist.apiPort,
    }),
  ])(
    "rejects a malformed active allowlist without filesystem fallback",
    (raw) => {
      admit();
      vi.stubEnv("PUTDUK_WORKERD_LOCAL_ALLOWLIST", raw);
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
    },
  );

  it.each([undefined, "", "other-scope"])(
    "rejects partial or wrong admission markers",
    (scope) => {
      admit();
      vi.stubEnv("PUTDUK_WORKERD_LOCAL_AUTH_SCOPE", scope);
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
    },
  );

  it.each(["development", "staging", "production"])(
    "does not admit workerd HTTP in %s",
    (appEnv) => {
      admit();
      vi.stubEnv("APP_ENV", appEnv);
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
    },
  );

  it.each(["", "/tmp/unadmitted-config.toml"])(
    "rejects a conflicting filesystem override",
    (path) => {
      admit();
      vi.stubEnv("PUTDUK_LOCAL_SUPABASE_CONFIG_PATH", path);
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
    },
  );

  it("does not derive admission from the requested URL or serialize server scope", () => {
    admit();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
    expect(() => getSupabaseBrowserAuthConfig()).toThrow(
      "SUPABASE_BROWSER_CONFIG_INVALID",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", localUrl);
    expect(JSON.stringify(getSupabaseBrowserAuthConfig())).not.toMatch(
      /WORKERD|apiPort|dbPort|projectId|ci-auth/,
    );
  });

  it.each(["staging", "production"])(
    "preserves exact approved HTTPS validation in %s",
    (appEnv) => {
      admit();
      vi.stubEnv("APP_ENV", appEnv);
      vi.stubEnv("PUTDUK_WORKERD_LOCAL_ALLOWLIST", "not-json");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", remoteUrl);
      expect(getSupabaseBrowserAuthConfig()).toEqual({
        url: remoteUrl,
        publishableKey,
      });
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_URL",
        "https://different-project.supabase.co",
      );
      expect(() => getSupabaseBrowserAuthConfig()).toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
    },
  );

  it("cannot use admission to forward a privileged key", () => {
    admit();
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      legacyKey("service_role"),
    );
    expect(() => getSupabaseBrowserAuthConfig()).toThrow(
      "SUPABASE_BROWSER_CONFIG_INVALID",
    );
  });
});
