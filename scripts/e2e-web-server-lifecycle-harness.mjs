/**
 * Linux 경로에서 e2e-web-server 시그널/프로세스 그룹 teardown을 검증한다.
 * Playwright가 webServer를 detached 그룹으로 띄운 뒤 kill(-pid) 하는 방식을 흉내 낸다.
 *
 * 사용: node scripts/e2e-web-server-lifecycle-harness.mjs
 * 기대: SIGTERM 후 10초 안에 래퍼 종료, 손자 잔존 없음.
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const isWin = process.platform === "win32";

function log(message, extra = {}) {
  console.log(
    `[lifecycle-harness] ${message} ${JSON.stringify({ t: new Date().toISOString(), ...extra })}`,
  );
}

async function capturePs(matchPid) {
  if (isWin) {
    return { raw: "(windows-skip)", matched: [] };
  }
  // debian-slim 등에는 ps가 없을 수 있어 /proc만 사용한다.
  const { readdirSync, readFileSync } = await import("node:fs");
  const matched = [];
  for (const ent of readdirSync("/proc", { withFileTypes: true })) {
    if (!ent.isDirectory() || !/^\d+$/.test(ent.name)) continue;
    try {
      const stat = readFileSync(`/proc/${ent.name}/stat`, "utf8");
      const cmd = readFileSync(`/proc/${ent.name}/cmdline`, "utf8").replace(
        /\0/g,
        " ",
      );
      const closed = stat.indexOf(")");
      const rest = stat.slice(closed + 2).split(" ");
      const ppid = rest[1];
      const pgid = rest[2];
      const pid = ent.name;
      if (
        pid === String(matchPid) ||
        ppid === String(matchPid) ||
        pgid === String(matchPid) ||
        cmd.includes("e2e-web-server") ||
        cmd.includes("grandchild-alive")
      ) {
        matched.push(`pid=${pid} ppid=${ppid} pgid=${pgid} cmd=${cmd.trim()}`);
      }
    } catch {
      // 종료 경쟁
    }
  }
  return { raw: matched.join("\n"), matched };
}

async function main() {
  const started = Date.now();
  const grandchildJs =
    "console.error('grandchild-alive pid=' + process.pid); setInterval(function () {}, 1000);";

  const wrapperArgs = [
    "scripts/e2e-web-server.mjs",
    process.execPath,
    "-e",
    grandchildJs,
  ];

  // Playwright launchProcess와 같이 non-Windows에서 detached 그룹 리더로 띄운다.
  const wrapper = spawn(process.execPath, wrapperArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    env: process.env,
  });

  let output = "";
  const append = (c) => {
    const text = c.toString();
    output += text;
    process.stderr.write(text);
  };
  wrapper.stdout.on("data", append);
  wrapper.stderr.on("data", append);

  log("wrapper-spawned", {
    wrapperPid: wrapper.pid,
    detachedGroupLeader: !isWin,
  });

  await delay(1_000);
  const before = await capturePs(wrapper.pid);
  log("process-tree-before-signal", { matched: before.matched });

  if (!wrapper.pid) {
    log("FAIL-no-wrapper-pid");
    process.exit(1);
  }

  try {
    if (!isWin) {
      process.kill(-wrapper.pid, "SIGTERM");
      log("sent-sigterm-process-group", { pgid: wrapper.pid });
    } else {
      wrapper.kill("SIGTERM");
      log("sent-sigterm-wrapper", { wrapperPid: wrapper.pid });
    }
  } catch (error) {
    log("signal-send-error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const closed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 10_000);
    wrapper.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  const elapsedMs = Date.now() - started;
  if (closed === "timeout") {
    log("FAIL-wrapper-close-timeout", { elapsedMs });
    try {
      if (!isWin) process.kill(-wrapper.pid, "SIGKILL");
      else wrapper.kill("SIGKILL");
    } catch {
      // ignore
    }
    process.exit(2);
  }

  await delay(400);
  const after = await capturePs(wrapper.pid);
  const survivors = after.matched.filter((line) =>
    line.includes("grandchild-alive"),
  );

  log("wrapper-closed", {
    closed,
    elapsedMs,
    matchedAfter: after.matched,
    instrumentationSawSignal: output.includes("signal-received"),
    instrumentationSawShutdown: output.includes("shutdown-start"),
    instrumentationSawChildExit: output.includes("child-exit"),
    instrumentationSawWrapperExit: output.includes("wrapper-exit"),
  });

  if (survivors.length > 0) {
    log("FAIL-grandchild-leaked", { survivors });
    process.exit(3);
  }

  log("PASS", { elapsedMs, close: closed });
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
