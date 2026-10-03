/** Windows-local QA storage. Source and Git stay in the authorized C: repo. */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  LIVE_EXTERNAL_ENV_KEYS,
  redactSupabaseCliLine,
} from "./capture-local-supabase-env.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedRoot = "C:\\Users\\PC\\Desktop\\putduk-mining";
const expectedOrigin = "https://github.com/goldeget/putduk-mining.git";
const qaRoot = "D:\\PUTDUK-MINING-QA";

function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("QA_GIT_IDENTITY_UNAVAILABLE");
  return result.stdout;
}

function protectedChanges() {
  return [
    ...new Set(
      (
        git(["diff", "HEAD", "--name-only", "-z"]) +
        git(["ls-files", "--others", "--exclude-standard", "-z"])
      )
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .sort()
    .map((relative) => {
      const filename = path.resolve(root, relative);
      if (
        !filename.startsWith(`${root}${path.sep}`) ||
        relative.split(/[\\/]/).includes(".worktrees") ||
        (existsSync(filename) &&
          !realpathSync(filename)
            .toLowerCase()
            .startsWith(`${root}${path.sep}`.toLowerCase()))
      ) {
        throw new Error("BLOCKED_TARGET_SCOPE");
      }
      return {
        path: relative,
        sha256: existsSync(filename)
          ? createHash("sha256").update(readFileSync(filename)).digest("hex")
          : null,
      };
    });
}

function inspectVolume() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-Volume -DriveLetter D | Select-Object DriveLetter,FileSystemLabel,FileSystem,HealthStatus,SizeRemaining | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw new Error("QA_VOLUME_UNVERIFIED");
  const volume = JSON.parse(result.stdout.trim());
  if (
    volume.DriveLetter !== "D" ||
    volume.FileSystemLabel !== "ESD-USB" ||
    volume.HealthStatus !== "Healthy"
  ) {
    throw new Error("BLOCKED_TARGET_SCOPE");
  }
  if (volume.SizeRemaining < 512 * 1024 * 1024) {
    throw new Error("QA_VOLUME_CAPACITY_LOW");
  }
  return volume;
}

/** Git의 현재 저장소 목록만 사용한다. 중첩 worktree·캐시를 순회하지 않는다. */
function repositoryFiles() {
  const files = [
    ...new Set(
      (
        git(["ls-files", "-z"]) +
        git(["ls-files", "--others", "--exclude-standard", "-z"])
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  return files.filter((relative) => {
    const filename = path.resolve(root, relative);
    if (
      !filename.startsWith(`${root}${path.sep}`) ||
      relative.split(/[\\/]/).includes(".worktrees")
    ) {
      throw new Error("BLOCKED_TARGET_SCOPE");
    }
    if (!existsSync(filename)) return false;
    if (
      !realpathSync(filename)
        .toLowerCase()
        .startsWith(`${root}${path.sep}`.toLowerCase())
    ) {
      throw new Error("BLOCKED_TARGET_SCOPE");
    }
    return true;
  });
}

async function execute(command, args, cwd, env, logPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      lines.on("line", (line) => {
        try {
          const safe = redactSupabaseCliLine(line);
          appendFileSync(logPath, `${safe}\n`, "utf8");
          process.stdout.write(`${safe}\n`);
        } catch (error) {
          child.kill();
          reject(error);
        }
      });
    }
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  if (
    process.platform !== "win32" ||
    root.toLowerCase() !== expectedRoot.toLowerCase() ||
    git(["remote", "get-url", "origin"]).trim() !== expectedOrigin
  ) {
    throw new Error("BLOCKED_TARGET_SCOPE");
  }

  const [task = "prepare", ...filters] = process.argv.slice(2);
  if (
    ![
      "prepare",
      "unit",
      "admin-unit",
      "typecheck",
      "lint",
      "assets",
      "format",
    ].includes(task)
  ) {
    throw new Error("QA_TASK_UNSUPPORTED");
  }
  for (const filter of filters) {
    const normalized = filter.replaceAll("\\", "/");
    const prefix = task === "admin-unit" ? "apps/admin/tests/" : "tests/unit/";
    const filename = path.resolve(root, normalized);
    if (
      !["unit", "admin-unit"].includes(task) ||
      !normalized.startsWith(prefix) ||
      !normalized.endsWith(".test.ts") ||
      !filename.startsWith(`${path.resolve(root, prefix)}${path.sep}`) ||
      !existsSync(filename)
    ) {
      throw new Error("QA_TEST_SCOPE_REJECTED");
    }
  }

  const volume = inspectVolume();
  const runName = `codex-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const run = path.join(qaRoot, runName);
  if (existsSync(run)) throw new Error("QA_RUN_ALREADY_EXISTS");
  mkdirSync(run, { recursive: true });
  for (const directory of [
    "tmp",
    "logs",
    "reports",
    "screenshots",
    "playwright",
  ])
    mkdirSync(path.join(run, directory));

  const env = { ...process.env };
  for (const key of [
    ...LIVE_EXTERNAL_ENV_KEYS,
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WITHDRAWAL_DATA_KEY",
    "DATABASE_URL",
    "DIRECT_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "LOCAL_SUPABASE_DB_URL",
  ]) {
    delete env[key];
  }
  env.TEMP = path.join(run, "tmp");
  env.TMP = env.TEMP;
  env.TMPDIR = env.TEMP;
  env.PUTDUK_QA_RUN_DIR = run;
  env.PUTDUK_UI_EVIDENCE_DIR = path.join(run, "screenshots");
  env.PLAYWRIGHT_HTML_OUTPUT_DIR = path.join(run, "playwright", "html");
  env.PLAYWRIGHT_JSON_OUTPUT_FILE = path.join(run, "playwright", "report.json");
  env.PLAYWRIGHT_JUNIT_OUTPUT_FILE = path.join(run, "playwright", "report.xml");
  env.NO_COLOR = "1";
  delete env.FORCE_COLOR;

  const manifest = {
    startedAt: new Date().toISOString(),
    task,
    sourceRoot: root,
    origin: expectedOrigin,
    head: git(["rev-parse", "HEAD"]).trim(),
    volume,
    run,
    hostTempUnchanged: os.tmpdir(),
    childTemp: env.TEMP,
    protectedChanges: protectedChanges(),
    status: "PREPARED",
    commands: [],
    limits: [
      "No source relocation, cleanup, Docker operation or remote mutation.",
      "Build outputs and hardcoded evidence paths are not redirected by this runner.",
      "FAT32 single-file limit applies; no DB image or large archive is stored here.",
    ],
  };
  const manifestPath = path.join(run, "run.json");
  const save = () =>
    writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  save();
  process.stdout.write(`PUTDUK_QA_RUN_DIR=${run}\n`);

  const tempProbe = spawnSync(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const tmp=os.tmpdir();fs.writeFileSync(path.join(tmp,'qa-temp-probe.json'),JSON.stringify({tmp}));process.stdout.write(tmp)",
    ],
    { env, encoding: "utf8", windowsHide: true },
  );
  if (tempProbe.status !== 0 || tempProbe.stdout !== env.TEMP) {
    manifest.status = "ERROR";
    manifest.error = "QA_CHILD_TEMP_NOT_REDIRECTED";
    manifest.finishedAt = new Date().toISOString();
    save();
    throw new Error("QA_CHILD_TEMP_NOT_REDIRECTED");
  }
  manifest.childTempVerified = true;

  const commands = [];
  if (task === "unit" || task === "admin-unit") {
    const admin = task === "admin-unit";
    const scopeFilters = filters.map((filter) =>
      admin
        ? path.relative(
            path.join(root, "apps/admin"),
            path.resolve(root, filter),
          )
        : filter,
    );
    commands.push({
      command: process.execPath,
      cwd: admin ? path.join(root, "apps/admin") : root,
      args: [
        path.join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--maxWorkers=2",
        ...scopeFilters,
        "--reporter=default",
        "--reporter=json",
        `--outputFile=${path.join(run, "reports", `${task}.json`)}`,
      ],
    });
  }
  if (task === "typecheck") {
    for (const cwd of [root, path.join(root, "apps/admin")]) {
      commands.push({
        command: process.execPath,
        cwd,
        args: [
          path.join(root, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "--incremental",
          "false",
        ],
      });
    }
  }
  if (task === "assets") {
    commands.push({
      command: process.execPath,
      cwd: root,
      args: [path.join(root, "scripts/verify-brand-assets.mjs")],
    });
  }
  if (task === "lint" || task === "format") {
    const files = repositoryFiles().filter((filename) =>
      task === "lint"
        ? /\.(?:[cm]?js|jsx|ts|tsx)$/.test(filename)
        : /\.(?:[cm]?js|jsx|ts|tsx|html|css|json|ya?ml|mdx?|svg)$/.test(
            filename,
          ),
    );
    if (files.length === 0) throw new Error("QA_SOURCE_LIST_EMPTY");
    manifest.checkedFiles = files;
    // Windows 명령줄 길이 제한을 지키면서 모든 대상 파일을 검사한다.
    for (let index = 0; index < files.length; index += 100) {
      commands.push({
        command: process.execPath,
        cwd: root,
        args:
          task === "lint"
            ? [
                path.join(root, "node_modules/eslint/bin/eslint.js"),
                "--max-warnings=0",
                "--no-warn-ignored",
                ...files.slice(index, index + 100),
              ]
            : [
                path.join(root, "node_modules/prettier/bin/prettier.cjs"),
                "--check",
                "--ignore-unknown",
                ...files.slice(index, index + 100),
              ],
      });
    }
  }

  let exitCode = 0;
  try {
    for (const [index, command] of commands.entries()) {
      manifest.status = "RUNNING";
      save();
      const logPath = path.join(run, "logs", `${task}-${index + 1}.log`);
      writeFileSync(logPath, "", "utf8");
      const result = await execute(
        command.command,
        command.args,
        command.cwd,
        env,
        logPath,
      );
      manifest.commands.push({ ...command, ...result, logPath });
      if (result.code !== 0) {
        exitCode = result.code ?? 1;
        break;
      }
    }
    manifest.protectedChangesAfter = protectedChanges();
    manifest.protectedChangesUnchanged =
      JSON.stringify(manifest.protectedChanges) ===
      JSON.stringify(manifest.protectedChangesAfter);
    if (!manifest.protectedChangesUnchanged) exitCode = 1;
    const report = path.join(run, "reports", `${task}.json`);
    if (existsSync(report)) {
      const safe = redactSupabaseCliLine(readFileSync(report, "utf8"));
      writeFileSync(report, safe, "utf8");
      manifest.reportBytes = statSync(report).size;
    }
    manifest.status =
      commands.length === 0 ? "PREPARED" : exitCode === 0 ? "PASS" : "FAIL";
  } catch (error) {
    manifest.status = "ERROR";
    manifest.error = redactSupabaseCliLine(String(error));
    exitCode = 1;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    save();
  }
  process.stdout.write(
    `QA_STATUS=${manifest.status} evidence=${manifestPath}\n`,
  );
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${redactSupabaseCliLine(String(error))}\n`);
  process.exitCode = 1;
});
