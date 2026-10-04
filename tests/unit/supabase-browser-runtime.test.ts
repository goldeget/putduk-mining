import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicEnv, parseSupabaseBrowserAuthConfig } from "@/lib/env/public";
import { getSupabaseBrowserAuthConfig } from "@/lib/env/supabase-browser.server";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createBrowserClient } from "@supabase/ssr";
import { loadJobLocalAllowlist } from "../../scripts/capture-local-supabase-env.mjs";

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
