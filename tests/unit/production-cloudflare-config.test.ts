import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import memberConfig from "../../cloudflare.config";
import adminConfig from "../../apps/admin/cloudflare.config";
import { loadEnv } from "vite";
import memberViteConfig from "../../vite.config";
import adminViteConfig from "../../apps/admin/vite.config";

vi.mock("vite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vite")>()),
  loadEnv: vi.fn(() => ({
    SUPABASE_SECRET_KEY: "local-file-secret-must-not-load",
  })),
}));
vi.mock("@cloudflare/vite-plugin", () => ({
  cloudflare: () => ({ name: "test-cf" }),
}));
vi.mock("vinext", () => ({ default: () => ({ name: "test-vinext" }) }));
vi.mock("vite-css-modules", () => ({
  patchCssModules: () => ({ name: "test-css" }),
}));
vi.mock("../../next.config", () => ({ default: {} }));
vi.mock("../../apps/admin/next.config", () => ({ default: {} }));

const key = "sb_publishable_production_fixture_not_a_real_key";
const qaKey = "sb_publishable_qa_fixture_not_a_real_key";
type Snapshot = {
  accountId: string;
  worker: {
    name: string;
    entrypoint: string;
    env?: Record<string, { type: string; value?: string }>;
    assets: { runWorkerFirst: string[] };
    workersDev?: boolean;
    previewUrls?: boolean;
    triggers?: unknown[];
  };
};
function config(app: "member" | "admin", mode: string | undefined): Snapshot {
  const factory = app === "member" ? memberConfig : adminConfig;
  return JSON.parse(JSON.stringify(factory({ mode, isPreview: false })));
}

describe("existing production Cloudflare target configuration", () => {
  beforeEach(() => {
    // The real Vite factories assign these directly, so track their original
    // presence/value before every case as well as the explicit key fixtures.
    for (const name of [
      "APP_ENV",
      "APP_TIMEZONE",
      "NEXT_PUBLIC_APP_URL",
      "ADMIN_APP_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "AI_PROVIDER_DISPATCH_ENABLED",
      "SUPABASE_SECRET_KEY",
    ])
      vi.stubEnv(name, process.env[name]);
    vi.stubEnv("PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY", key);
    vi.stubEnv("PUTDUK_QA_SUPABASE_PUBLISHABLE_KEY", qaKey);
    vi.mocked(loadEnv).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["member", "production-landing", "putduk-web", "https://putduk.com"],
    [
      "member",
      "production-member",
      "putduk-mining-web-staging",
      "https://mining.putduk.com",
    ],
    [
      "admin",
      "production-admin",
      "putduk-mining-admin-staging",
      "https://admin.mining.putduk.com",
    ],
  ] as const)(
    "maps %s/%s to only the existing target",
    (app, mode, name, url) => {
      const result = config(app, mode);
      expect(result.accountId).toBe("9dc502d4ef06b3b5374591de6e6933ca");
      expect(result.worker.name).toBe(name);
      expect(result.worker.env).toMatchObject({
        APP_ENV: { type: "text", value: "production" },
        APP_TIMEZONE: { type: "text", value: "UTC" },
        NEXT_PUBLIC_APP_URL: { type: "text", value: url },
        ADMIN_APP_URL: {
          type: "text",
          value: "https://admin.mining.putduk.com",
        },
        NEXT_PUBLIC_SUPABASE_URL: {
          type: "text",
          value: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
        },
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: { type: "text", value: key },
        AI_PROVIDER_DISPATCH_ENABLED: { type: "text", value: "false" },
      });
      expect(result.worker).not.toHaveProperty("triggers");
      expect(result.worker).not.toHaveProperty("workersDev");
      expect(result.worker).not.toHaveProperty("previewUrls");
      expect(JSON.stringify(result)).not.toContain("mhchzipznxbwbocdihlg");
      expect(JSON.stringify(result)).not.toContain(qaKey);
    },
  );

  it("gives the public entry no server secrets and sends all requests through its policy", () => {
    const worker = config("member", "production-landing").worker;
    expect(worker.entrypoint).toBe("./lib/cloudflare/landing-entry.ts");
    expect(worker.assets.runWorkerFirst).toEqual(["/*"]);
    expect(
      Object.values(worker.env ?? {}).some((b) => b.type === "secret"),
    ).toBe(false);
    expect(worker.env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(worker.env).not.toHaveProperty("WITHDRAWAL_DATA_KEY");
  });

  it.each([
    ["member", "production-member"],
    ["admin", "production-admin"],
  ] as const)(
    "requires opaque server-secret inheritance for %s",
    (app, mode) => {
      const worker = config(app, mode).worker;
      expect(worker.entrypoint).toBe("vinext/server/fetch-handler");
      expect(worker.env?.SUPABASE_SECRET_KEY).toEqual({ type: "secret" });
      expect(worker.env?.WITHDRAWAL_DATA_KEY).toEqual({ type: "secret" });
      expect(
        Object.values(worker.env ?? {}).every((b) =>
          ["text", "secret"].includes(b.type),
        ),
      ).toBe(true);
    },
  );

  it.each([
    undefined,
    "",
    "sb_secret_never_public",
    "eyJ.invalid.service_role",
  ])("rejects unavailable or non-publishable production key %s", (value) => {
    vi.stubEnv("PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY", value);
    expect(() => config("member", "production-member")).toThrow(
      /PRODUCTION_BLOCKED/,
    );
  });

  it.each([
    ["member", "production-admin"],
    ["admin", "production-member"],
    ["admin", "production-landing"],
    ["member", "production-membber"],
    ["admin", "prod-admin"],
  ] as const)(
    "rejects cross-app or misspelled production mode %s/%s",
    (app, mode) => {
      expect(() => config(app, mode)).toThrow(/PRODUCTION_BLOCKED/);
    },
  );

  it.each(["member", "admin"] as const)(
    "preserves isolated QA behavior for %s",
    (app) => {
      const worker = config(app, "qa").worker;
      expect(worker.name).toBe(`putduk-mining-${app}-staging-ab1de38`);
      expect(worker.env?.APP_ENV?.value).toBe("staging");
      expect(worker.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.value).toBe(
        qaKey,
      );
      expect(worker.previewUrls).toBe(false);
      expect(worker.triggers).toEqual([]);
    },
  );

  it.each(["member", "admin"] as const)(
    "preserves default CI build target for %s",
    (app) => {
      expect(config(app, "production").worker.name).toBe(
        app === "member"
          ? "putduk-mining-web-staging"
          : "putduk-mining-admin-staging",
      );
      expect(config(app, "development").worker.env).toBeUndefined();
    },
  );
  it.each([
    ["member", "production-landing", "https://putduk.com"],
    ["member", "production-member", "https://mining.putduk.com"],
    ["admin", "production-admin", "https://admin.mining.putduk.com"],
  ] as const)(
    "isolates %s/%s build inputs before Next CSP evaluation",
    async (app, mode, origin) => {
      vi.stubEnv("APP_ENV", "staging");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://invalid-previous-input.test");
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_URL",
        "https://mhchzipznxbwbocdihlg.supabase.co",
      );
      const factory = app === "member" ? memberViteConfig : adminViteConfig;
      if (typeof factory !== "function")
        throw new Error("Expected Vite config factory");
      const result = await factory({
        command: "build",
        mode,
        isPreview: false,
      });
      expect(loadEnv).not.toHaveBeenCalled();
      expect(result.envDir).toBe(false);
      expect(process.env.APP_ENV).toBe("production");
      expect(process.env.NEXT_PUBLIC_APP_URL).toBe(origin);
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(
        "https://osrmyjgmpdspdcwqjwuv.supabase.co",
      );
    },
  );

  it.each(["member", "admin"] as const)(
    "continues local env loading for existing %s QA builds",
    async (app) => {
      const factory = app === "member" ? memberViteConfig : adminViteConfig;
      if (typeof factory !== "function")
        throw new Error("Expected Vite config factory");
      await factory({ command: "build", mode: "qa", isPreview: false });
      expect(loadEnv).toHaveBeenCalledOnce();
    },
  );
});
