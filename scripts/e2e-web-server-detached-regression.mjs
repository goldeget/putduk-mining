/**
 * 구버전 버그 재현용: 손자를 detached:true로 분리한 뒤 Playwright식 kill(-pid)를 보낸다.
 * 파이프가 안 닫히면 close 대기가 타임아웃되어야 한다(회귀 신호).
 *
 * 사용: node scripts/e2e-web-server-detached-regression.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

if (process.platform === "win32") {
  console.error("[detached-regression] Linux/mac only");
  process.exit(0);
}

function log(message, extra = {}) {
  console.log(
    `[detached-regression] ${message} ${JSON.stringify({ t: new Date().toISOString(), ...extra })}`,
  );
}

async function main() {
  const started = Date.now();
  // Playwright가 띄우는 webServer와 같이 그룹 리더 셸 역할의 중간 프로세스
  const leader = spawn(
    process.execPath,
    [
      "-e",
      `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', "console.error('detached-grandchild'); setInterval(()=>{},1000)"], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (c) => process.stdout.write(c));
      child.stderr.on('data', (c) => process.stderr.write(c));
      console.error('leader-ready wrapperPid=' + process.pid + ' childPid=' + child.pid);
      setInterval(() => {}, 1000);
      `,
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let out = "";
  leader.stdout.on("data", (c) => {
    out += c.toString();
    process.stderr.write(c);
  });
  leader.stderr.on("data", (c) => {
    out += c.toString();
    process.stderr.write(c);
  });

  await delay(800);
  log("before-kill", { leaderPid: leader.pid, out: out.trim() });

  process.kill(-leader.pid, "SIGKILL");
  log("sent-sigkill-group", { pgid: leader.pid });

  const closed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 5_000);
    leader.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  const elapsedMs = Date.now() - started;
  if (closed === "timeout") {
    log("REPRODUCED-HANG", {
      elapsedMs,
      note: "leader close 미발생: 분리된 손자가 stdout 파이프를 붙잡은 상태와 동일",
    });
    try {
      process.kill(-leader.pid, "SIGKILL");
    } catch {
      // ignore
    }
    // 잔존 node 정리
    spawn("pkill", ["-f", "detached-grandchild"], { stdio: "ignore" });
    process.exit(0);
  }

  log("leader-closed-quickly", {
    closed,
    elapsedMs,
    note: "환경에 따라 close가 빨리 올 수도 있음. 손자 잔존 여부를 본다.",
  });

  const { readdirSync, readFileSync } = await import("node:fs");
  const leaked = [];
  for (const ent of readdirSync("/proc", { withFileTypes: true })) {
    if (!ent.isDirectory() || !/^\d+$/.test(ent.name)) continue;
    try {
      const cmd = readFileSync(`/proc/${ent.name}/cmdline`, "utf8");
      if (cmd.includes("detached-grandchild")) {
        leaked.push({ pid: ent.name, cmd: cmd.replace(/\0/g, " ").trim() });
        try {
          process.kill(Number(ent.name), "SIGKILL");
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  if (leaked.length) {
    log("REPRODUCED-LEAK", { leaked, elapsedMs });
    process.exit(0);
  }

  log("NO-REPRO", { elapsedMs, closed });
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
