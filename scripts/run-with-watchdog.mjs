/**
 * 외부 watchdog: 제한 시간 안에 자식 프로세스가 끝나지 않으면 트리 종료 후 실패.
 * Playwright 내부 timeout을 늘려 hang을 숨기지 않는다.
 *
 * 사용: node scripts/run-with-watchdog.mjs <seconds> -- <command> [args...]
 */
import { spawn } from "node:child_process";

const sep = process.argv.indexOf("--");
if (sep < 2 || sep === process.argv.length - 1) {
  console.error(
    "usage: node scripts/run-with-watchdog.mjs <seconds> -- <command> [args...]",
  );
  process.exit(2);
}

const seconds = Number(process.argv[sep - 1]);
if (!Number.isFinite(seconds) || seconds <= 0) {
  console.error("watchdog seconds must be a positive number");
  process.exit(2);
}

const command = process.argv[sep + 1];
const args = process.argv.slice(sep + 2);
const isWin = process.platform === "win32";
const limitMs = Math.floor(seconds * 1000);
const started = Date.now();

console.error(
  `[watchdog] start limitSec=${seconds} cmd=${command} args=${JSON.stringify(args)}`,
);

const child = spawn(command, args, {
  stdio: "inherit",
  shell: isWin,
  env: process.env,
  windowsHide: true,
});

let settled = false;
const timer = setTimeout(() => {
  if (settled) return;
  settled = true;
  const elapsedMs = Date.now() - started;
  console.error(
    `[watchdog] TIMEOUT elapsedMs=${elapsedMs} killing process tree pid=${child.pid}`,
  );
  try {
    if (isWin && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  } catch (error) {
    console.error("[watchdog] kill-error", error);
  }
  setTimeout(() => process.exit(124), 1_000);
}, limitMs);

child.on("exit", (code, signal) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  console.error(
    `[watchdog] child-exit code=${code} signal=${signal} elapsedMs=${elapsedMs}`,
  );
  process.exit(code ?? (signal ? 1 : 0));
});

child.on("error", (error) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  console.error("[watchdog] child-error", error);
  process.exit(1);
});
