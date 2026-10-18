import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadJobLocalAllowlist } from "../../../scripts/capture-local-supabase-env.mjs";
import { createLocalServiceRoleClient } from "../../e2e/fixtures/local-auth";

const createClient = vi.hoisted(() => vi.fn(() => ({ localGuardStub: true })));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const scope = loadJobLocalAllowlist();
const validUrl = `http://127.0.0.1:${scope.apiPort}`;
const projectKeys = [
  "LOCAL_SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_REF",
];

beforeEach(() => {
  createClient.mockClear();
  for (const key of [
    ...projectKeys,
    "SUPABASE_URL",
    "DATABASE_URL",
    "DIRECT_URL",
    "LOCAL_SUPABASE_DB_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WITHDRAWAL_DATA_KEY",
  ]) {
    vi.stubEnv(key, "");
  }
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", validUrl);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_inert_local_guard_test");
});

afterEach(() => vi.unstubAllEnvs());

describe("local service-role fixture target admission", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])(
    "admits the configured local API at %s without networking",
    (host) => {
      const url = `http://${host}:${scope.apiPort}`;
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(createLocalServiceRoleClient()).toEqual({ localGuardStub: true });
      expect(createClient).toHaveBeenCalledExactlyOnceWith(
        url,
        "sb_secret_inert_local_guard_test",
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
    },
  );

  it.each([
    "http://outside.invalid:58421",
    `http://127.0.0.1.invalid:${scope.apiPort}`,
    `http://localhost.invalid:${scope.apiPort}`,
    "http://127.0.0.1:1",
    `https://127.0.0.1:${scope.apiPort}`,
    `http://127.0.0.1:${scope.apiPort}/auth`,
    `${validUrl}?target=external`,
    `${validUrl}#target`,
    `http://inert:inert@127.0.0.1:${scope.apiPort}`,
    "https://osrmyjgmpdspdcwqjwuv.supabase.co",
    "not-a-url",
  ])("rejects unsafe target %s before client construction", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    expect(() => createLocalServiceRoleClient()).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["production", "staging"])(
    "rejects %s app environment before client construction",
    (appEnv) => {
      vi.stubEnv("APP_ENV", appEnv);
      expect(() => createLocalServiceRoleClient()).toThrow(
        "PRODUCTION_ENV_REJECTED",
      );
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each(projectKeys)("rejects a different job project in %s", (key) => {
    vi.stubEnv(key, `${scope.projectId}-different-job`);
    expect(() => createLocalServiceRoleClient()).toThrow(
      "LOCAL_AUTH_PROJECT_SCOPE_REJECTED",
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("admits explicitly matching job project fields", () => {
    for (const key of projectKeys) vi.stubEnv(key, scope.projectId);
    createLocalServiceRoleClient();
    expect(createClient).toHaveBeenCalledOnce();
  });
});
