import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const isListing = process.argv.includes("--list");

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    if (isListing) {
      return name === "NEXT_PUBLIC_SUPABASE_URL"
        ? "http://127.0.0.1:54321"
        : "list-only-not-a-credential";
    }
    throw new Error(
      `${name} is required. CI must provide it. Do not generate a separate fallback key.`,
    );
  }
  if (value.includes("osrmyjgmpdspdcwqjwuv")) {
    throw new Error(`${name} points at the remote Supabase project.`);
  }
  return value;
}

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const secretKey = required("SUPABASE_SECRET_KEY");
const withdrawalDataKey = required("WITHDRAWAL_DATA_KEY");

const sharedEnv = {
  APP_ENV: "test",
  APP_TIMEZONE: "UTC",
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  WITHDRAWAL_DATA_KEY: withdrawalDataKey,
  // Next가 gitignored .env.local의 원격 값을 읽지 않도록 로컬 값을 강제한다.
  FORCE_COLOR: process.env.FORCE_COLOR ?? "0",
};

/** 회원 머니 포커스 스펙은 admin 앱을 기동하지 않아 로컬 콜드스타트 경쟁을 줄인다. */
function needsAdminWebServer() {
  if (process.env.E2E_WITH_ADMIN_SERVER === "1") return true;
  if (process.env.E2E_SKIP_ADMIN_SERVER === "1") return false;
  const args = process.argv.join(" ");
  const memberMoneyOnly =
    /first-krw-withdrawal|first-usdt-withdrawal|withdrawal-negative-guards|public-admin-boundary|support-channel-talk|mining-product/.test(
      args,
    );
  const adminSpecs =
    /admin-session-totp|success-visual-evidence|admin-krw-browser-money|admin-usdt-browser-money|admin-withdrawal-step-up/.test(
      args,
    ) ||
    args.includes("test:e2e:auth:admin") ||
    args.includes("test:e2e:auth:visual");
  if (memberMoneyOnly && !adminSpecs) return false;
  return true;
}

const adminWebServerNeeded = needsAdminWebServer();
/**
 * 로컬에서 회원 앱과 관리자 앱을 동시에 next dev로 컴파일하면
 * authenticator statement_timeout(8s)이 START 조회와 체험 시계 갱신을 취소한다.
 * CI는 러너 여유가 있어 next dev를 유지한다. 로컬 관리자 E2E는 빌드된 next start를 쓴다.
 */
const useNextStart =
  process.env.E2E_NEXT_START === "1" ||
  (process.env.E2E_NEXT_START !== "0" && adminWebServerNeeded && !isCI);
const memberWebCommand = useNextStart
  ? "node scripts/e2e-web-server.mjs pnpm exec next start --hostname 127.0.0.1 --port 3000"
  : "node scripts/e2e-web-server.mjs pnpm exec next dev --hostname 127.0.0.1 --port 3000";
const adminWebCommand = useNextStart
  ? "node scripts/e2e-web-server.mjs pnpm --dir apps/admin exec next start --hostname 127.0.0.1 --port 3100"
  : "node scripts/e2e-web-server.mjs pnpm --dir apps/admin exec next dev --hostname 127.0.0.1 --port 3100";

if (
  supabaseUrl.includes("osrmyjgmpdspdcwqjwuv") ||
  !supabaseUrl.startsWith("http://")
) {
  throw new Error(
    "Authenticated Playwright refuses non-local Supabase credentials.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e/authenticated",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // 로컬 Docker·콜드 Next 기동을 고려. CI job timeout-minutes는 변경하지 않는다.
  timeout: 180_000,
  reporter: isCI ? [["line"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/success-visual-evidence.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      // 채굴 스펙이 390/834/1440을 직접 연다. Pixel 7에서 같은 매트릭스를 한 번 더 돌리지 않는다.
      testIgnore: [
        "**/success-visual-evidence.spec.ts",
        "**/mining-product.spec.ts",
      ],
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "visual-evidence",
      testMatch: "**/success-visual-evidence.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // e2e-web-server는 손자를 Playwright 프로세스 그룹 안에 둔다.
      // Linux teardown은 gracefulShutdown → 실패 시 kill(-pid) 순이다.
      command: memberWebCommand,
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !isCI,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
      stdout: (isCI ? "pipe" : "ignore") as "pipe" | "ignore",
      env: {
        ...process.env,
        ...sharedEnv,
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
        NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY: "putduk-e2e-plugin-key",
        CHANNEL_TALK_MEMBER_HASH_SECRET: "aa".repeat(32),
      },
    },
    ...(adminWebServerNeeded
      ? [
          {
            command: adminWebCommand,
            url: "http://127.0.0.1:3100/login",
            reuseExistingServer: !isCI,
            timeout: 180_000,
            gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
            stdout: (isCI ? "pipe" : "ignore") as "pipe" | "ignore",
            env: {
              ...process.env,
              ...sharedEnv,
              ADMIN_APP_URL: "http://127.0.0.1:3100",
              NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
              NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY: "",
              CHANNEL_TALK_MEMBER_HASH_SECRET: "",
            },
          },
        ]
      : []),
  ],
});
