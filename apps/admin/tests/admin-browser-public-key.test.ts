import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createBrowserClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient,
}));

import { getAdminEnv } from "@/lib/env";
import { createAdminBrowserClient } from "@/lib/supabase/browser";

function legacyKey(role: string) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.fixture`;
}

const url = "http://127.0.0.1:54321";
const publishableKey = "sb_publishable_admin_browser_fixture";

function stubAdminEnv(key: string) {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_server_only_fixture_value");
  vi.stubEnv("ADMIN_APP_URL", "http://127.0.0.1:3100");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("admin browser public key role", () => {
  it.each([
    "sb_secret_must_never_reach_the_admin_browser",
    legacyKey("service_role"),
    legacyKey("authenticated"),
    "arbitrary-key-with-a-long-enough-length",
  ])("rejects a non-public key without echoing it", (key) => {
    expect(() =>
      createAdminBrowserClient({ url, publishableKey: key }),
    ).toThrow(new Error("SUPABASE_BROWSER_CONFIG_INVALID"));
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("rejects a service role key from the public env fallback", () => {
    const key = legacyKey("service_role");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    let caught: Error | undefined;
    try {
      createAdminBrowserClient();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toBe("SUPABASE_BROWSER_CONFIG_INVALID");
    expect(caught?.message).not.toContain(key);
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("accepts a publishable key and a legacy anon key", () => {
    const anonKey = legacyKey("anon");
    createAdminBrowserClient({ url, publishableKey });
    createAdminBrowserClient({ url, publishableKey: anonKey });
    expect(createBrowserClient).toHaveBeenNthCalledWith(
      1,
      url,
      publishableKey,
      expect.any(Object),
    );
    expect(createBrowserClient).toHaveBeenNthCalledWith(
      2,
      url,
      anonKey,
      expect.any(Object),
    );
  });

  it("rejects a service role public key before operator pages read it", () => {
    const key = legacyKey("service_role");
    stubAdminEnv(key);
    let caught: Error | undefined;
    try {
      getAdminEnv();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toBe("SUPABASE_BROWSER_CONFIG_INVALID");
    expect(caught?.message).not.toContain(key);
  });

  it("still returns a publishable public key for the operator browser", () => {
    stubAdminEnv(publishableKey);
    expect(getAdminEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      publishableKey,
    );
  });
});
