/**
 * Playwright webServer용 프로세스 그룹 래퍼.
 * pnpm → next-server 손자 프로세스가 SIGTERM 후에도 남는 문제를 막는다.
 */
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: e2e-web-server.mjs <command> [args...]");
  process.exit(2);
}

const isWin = process.platform === "win32";
// Windows에서는 shell+argv 분리 시 인자가 깨질 수 있어 한 줄 명령으로 실행한다.
const child = isWin
  ? spawn(args.map(quoteForCmd).join(" "), {
      stdio: "inherit",
      env: process.env,
      shell: true,
      windowsHide: true,
    })
  : spawn(args[0], args.slice(1), {
      stdio: "inherit",
      env: process.env,
      // Linux/mac: 새 프로세스 그룹 → 종료 시 트리 전체를 끊는다.
      detached: true,
    });

function quoteForCmd(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

let shuttingDown = false;

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.pid) {
    process.exit(0);
    return;
  }
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(-child.pid, signal);
      setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }, 4_000).unref();
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
child.on("exit", (code, signal) => {
  if (shuttingDown) {
    process.exit(0);
    return;
  }
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
