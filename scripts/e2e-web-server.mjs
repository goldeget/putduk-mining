/**
 * Playwright webServer용 자식 프로세스 래퍼.
 *
 * Linux에서 Playwright는 webServer를 detached 프로세스 그룹으로 띄운 뒤
 * teardown 시 process.kill(-pid)로 그룹 전체를 끊는다.
 * 여기서 손자(pnpm/next)까지 다시 detached로 분리하면 Playwright kill이
 * 손자에 닿지 않고, 상속된 stdout 파이프가 닫히지 않아 runner가 멈춘다.
 *
 * 따라서 손자는 같은 프로세스 그룹에 두고, stdio는 래퍼가 중계한다.
 */
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: e2e-web-server.mjs <command> [args...]");
  process.exit(2);
}

const isWin = process.platform === "win32";
const FORCE_EXIT_MS = 4_000;
const HARD_EXIT_MS = 5_000;

function log(message, extra = {}) {
  const payload = {
    t: new Date().toISOString(),
    wrapperPid: process.pid,
    ...extra,
  };
  console.error(`[e2e-web-server] ${message} ${JSON.stringify(payload)}`);
}

function quoteForCmd(value) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

log("spawn-start", {
  platform: process.platform,
  command: args[0],
  argc: args.length,
  detachedChild: false,
});

// Windows: shell+argv 분리 시 인자가 깨질 수 있어 한 줄 명령으로 실행한다.
// Linux/mac: Playwright 프로세스 그룹 안에 남겨 kill(-pid)가 손자까지 닿게 한다.
const child = isWin
  ? spawn(args.map(quoteForCmd).join(" "), {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: true,
      windowsHide: true,
    })
  : spawn(args[0], args.slice(1), {
      // inherit이면 손자가 Playwright stdout 파이프 FD를 직접 붙잡는다.
      // pipe 중계로 래퍼 종료 시 runner 쪽 스트림이 닫히게 한다.
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      detached: false,
    });

if (child.stdout) {
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
}
if (child.stderr) {
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
}

log("spawned", { childPid: child.pid ?? null });

let shuttingDown = false;
let forceTimer = null;
let hardExitTimer = null;

function clearTimers() {
  if (forceTimer) {
    clearTimeout(forceTimer);
    forceTimer = null;
  }
  if (hardExitTimer) {
    clearTimeout(hardExitTimer);
    hardExitTimer = null;
  }
}

function forceKillChild() {
  if (!child.pid) return;
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      log("windows-taskkill", { childPid: child.pid });
    } else {
      // 그룹 분리를 하지 않으므로 직접 자식만 SIGKILL.
      // 동일 그룹 손자는 Playwright teardown의 kill(-pgid)가 처리한다.
      child.kill("SIGKILL");
      log("child-sigkill", { childPid: child.pid });
    }
  } catch (error) {
    log("force-kill-error", {
      childPid: child.pid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) {
    log("shutdown-already-in-progress", { signal });
    return;
  }
  shuttingDown = true;
  log("shutdown-start", { signal, childPid: child.pid ?? null });

  if (!child.pid) {
    log("wrapper-exit", { reason: "no-child", code: 0 });
    process.exit(0);
    return;
  }

  try {
    if (isWin) {
      forceKillChild();
    } else {
      child.kill(signal);
      log("child-signal-forward", { signal, childPid: child.pid });
    }
  } catch (error) {
    log("child-signal-forward-error", {
      signal,
      childPid: child.pid,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }

  // unref 금지: 이벤트 루프가 비면 fallback이 취소되어 래퍼가 멈출 수 있다.
  forceTimer = setTimeout(() => {
    log("force-kill-fallback", {
      afterMs: FORCE_EXIT_MS,
      childPid: child.pid ?? null,
    });
    forceKillChild();
  }, FORCE_EXIT_MS);

  hardExitTimer = setTimeout(() => {
    log("wrapper-hard-exit", {
      afterMs: HARD_EXIT_MS,
      childPid: child.pid ?? null,
    });
    process.exit(0);
  }, HARD_EXIT_MS);
}

process.on("SIGTERM", () => {
  log("signal-received", { signal: "SIGTERM" });
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  log("signal-received", { signal: "SIGINT" });
  shutdown("SIGINT");
});

child.on("exit", (code, signal) => {
  clearTimers();
  log("child-exit", {
    childPid: child.pid ?? null,
    code,
    signal,
    shuttingDown,
  });
  if (shuttingDown) {
    log("wrapper-exit", { reason: "child-exit-during-shutdown", code: 0 });
    process.exit(0);
    return;
  }
  const exitCode = code ?? (signal ? 1 : 0);
  log("wrapper-exit", { reason: "child-exit", code: exitCode });
  process.exit(exitCode);
});

child.on("error", (error) => {
  clearTimers();
  log("child-error", {
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exit(1);
});
