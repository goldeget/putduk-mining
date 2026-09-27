import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";

const key = randomBytes(32).toString("base64");
if (!key || /[\r\n]/.test(key)) {
  process.stderr.write("WITHDRAWAL_DATA_KEY generation failed.\n");
  process.exitCode = 1;
} else if (!process.env.GITHUB_ENV) {
  process.stderr.write(
    "GITHUB_ENV is required. The withdrawal data key is not printed.\n",
  );
  process.exitCode = 1;
} else {
  appendFileSync(process.env.GITHUB_ENV, `WITHDRAWAL_DATA_KEY=${key}\n`);
  process.stdout.write("recorded WITHDRAWAL_DATA_KEY\n");
}
