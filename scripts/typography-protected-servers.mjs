/**
 * 보호 화면 타이포그래피용 회원/운영자 Next 서버.
 *
 * `next dev` 컴파일이 로컬 Auth의 비밀번호 확인과 겹치면 GoTrue가
 * DB 응답을 기다리다 request_timeout(504)을 반환한다. 그래서 앱을
 * 먼저 빌드하고 `next start`로 띄운 뒤, 잘못된 자격 증명 조회가
 * 연속으로 빨라야만 준비 포트를 연다.
 * Playwright는 3199가 열리기 전에는 테스트를 시작하지 않는다.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const MEMBER_ORIGIN = "http://127.0.0.1:3000";
const ADMIN_ORIGIN = "http://127.0.0.1:3100";
const READY_PORT = 3199;
const GRANT_BUDGET_MS = 2_000;

const children = [];
let shuttingDown = false;
let readyServer = null;

function log(message) {
  console.error(`[typography-protected-servers] ${message}`);
}

function requiredLocal(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  if (value.includes("osrmyjgmpdspdcwqjwuv")) {
    throw new Error(`${name} points at the remote Supabase project.`);
  }
  return value;
}

function runToCompletion(label, command, env) {
  log(`run ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      env: { ...process.env, ...env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited code=${code ?? "null"}`));
    });
  });
}

function startDevServer(label, command, env) {
  log(`start ${label}`);
  const child = spawn(command, {
    env: { ...process.env, ...env },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(`${label} exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    shutdown(1);
  });
  children.push(child);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "none";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        log(`ready ${url}`);
        return;
      }
      last = String(response.status);
    } catch (error) {
      last = error instanceof Error ? error.name : "fetch-failed";
    }
    await delay(1_000);
  }
  throw new Error(`timed out waiting for ${url} (${last})`);
}

async function passwordGrantProbe() {
  const apiUrl = requiredLocal("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const apiKey = requiredLocal("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const started = Date.now();
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    body: JSON.stringify({
      email: "nobody@putduk.invalid",
      password: "not-a-real-password-1",
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  });
  return { ms: Date.now() - started, status: response.status };
}

async function waitForFastPasswordGrant() {
  const deadline = Date.now() + 90_000;
  let consecutive = 0;
  let last = "none";
  while (Date.now() < deadline) {
    try {
      const probe = await passwordGrantProbe();
      last = `status=${probe.status} ms=${probe.ms}`;
      if (probe.status === 400 && probe.ms <= GRANT_BUDGET_MS) {
        consecutive += 1;
        log(`auth grant probe ${last} streak=${consecutive}`);
        if (consecutive >= 2) return;
      } else {
        consecutive = 0;
        log(`auth grant slow ${last}`);
      }
    } catch (error) {
      consecutive = 0;
      last = error instanceof Error ? error.name : "probe-failed";
      log(`auth grant probe failed ${last}`);
    }
    await delay(1_000);
  }
  throw new Error(`local auth password grant stayed slow (${last})`);
}

function openReadyGate() {
  readyServer = createServer((request, response) => {
    response.writeHead(request.url === "/ready" ? 200 : 404, {
      "content-type": "text/plain; charset=utf-8",
    });
    response.end(request.url === "/ready" ? "ready\n" : "not-found\n");
  });
  return new Promise((resolve, reject) => {
    readyServer.once("error", reject);
    readyServer.listen(READY_PORT, "127.0.0.1", () => {
      log(`ready gate http://127.0.0.1:${READY_PORT}/ready`);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutdown code=${code}`);
  readyServer?.close();
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 1_000);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

async function main() {
  requiredLocal("NEXT_PUBLIC_SUPABASE_URL");
  requiredLocal("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  requiredLocal("SUPABASE_SECRET_KEY");
  requiredLocal("WITHDRAWAL_DATA_KEY");

  const memberEnv = { NEXT_PUBLIC_APP_URL: MEMBER_ORIGIN };
  const adminEnv = {
    ADMIN_APP_URL: ADMIN_ORIGIN,
    NEXT_PUBLIC_APP_URL: ADMIN_ORIGIN,
  };

  await runToCompletion("build member", "pnpm exec next build", memberEnv);
  await runToCompletion(
    "build admin",
    "pnpm --dir apps/admin exec next build",
    adminEnv,
  );

  startDevServer(
    "member",
    "node scripts/e2e-web-server.mjs pnpm exec next start --hostname 127.0.0.1 --port 3000",
    memberEnv,
  );
  await waitForHttp(`${MEMBER_ORIGIN}/login`, 180_000);
  await waitForFastPasswordGrant();

  startDevServer(
    "admin",
    "node scripts/e2e-web-server.mjs pnpm --dir apps/admin exec next start --hostname 127.0.0.1 --port 3100",
    adminEnv,
  );
  await waitForHttp(`${ADMIN_ORIGIN}/login`, 180_000);
  await waitForFastPasswordGrant();
  await openReadyGate();
}

main().catch((error) => {
  log(error instanceof Error ? error.message : "startup failed");
  shutdown(1);
});
