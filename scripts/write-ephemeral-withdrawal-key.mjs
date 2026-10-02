import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { formatAddMask } from "./capture-local-supabase-env.mjs";

/**
 * 마스킹을 env 기록보다 먼저 등록한다.
 * 워크플로 명령만 쓰고, 값 확인용 echo는 하지 않는다.
 */
export function recordWithdrawalDataKey({ key, writeEnv, writeStdout }) {
  const decoded = Buffer.from(key, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== key) {
    throw new Error("WITHDRAWAL_DATA_KEY generation failed.");
  }
  const mask = formatAddMask(key);
  writeStdout(mask);
  writeEnv(`WITHDRAWAL_DATA_KEY=${key}\n`);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return entry
      .replaceAll("\\", "/")
      .endsWith("scripts/write-ephemeral-withdrawal-key.mjs");
  }
}

function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
    process.stderr.write(
      "GITHUB_ENV is required. The withdrawal data key is not printed.\n",
    );
    process.exitCode = 1;
    return;
  }
  try {
    recordWithdrawalDataKey({
      key: randomBytes(32).toString("base64"),
      writeStdout: (line) => process.stdout.write(line),
      writeEnv: (line) => appendFileSync(process.env.GITHUB_ENV, line),
    });
  } catch {
    process.stderr.write("WITHDRAWAL_DATA_KEY generation failed.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("recorded WITHDRAWAL_DATA_KEY\n");
}

if (isDirectRun()) {
  main();
}
