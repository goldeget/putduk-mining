import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const baseline = "9ccc287c5c05b998a9ad345392e9ff07a03a5836";
const manifest = JSON.parse(
  readFileSync("docs/quality/WORKROOM-UNIT-DISPOSITION.json", "utf8"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expected = [
  "product-mining-shell.test.ts",
  "product-wallet-shell.test.ts",
  "product-shell-scroll.test.ts",
]
  .map((name) => "tests/unit/" + name)
  .sort();
if (
  JSON.stringify(manifest.retired.map((row) => row.path).sort()) !==
  JSON.stringify(expected)
)
  throw Error("WORKROOM_UNIT_RETIREMENT_ROSTER");
for (const row of manifest.retired) {
  const original = execFileSync("git", ["show", `${baseline}:${row.path}`]);
  const current = Buffer.from(
    readFileSync(row.path, "utf8").replaceAll("\r\n", "\n"),
  );
  if (
    hash(original) !== row.sha256 ||
    hash(current) !== row.sha256 ||
    !row.assertions.length ||
    !row.reason ||
    !row.replacements.length
  )
    throw Error("WORKROOM_UNIT_RETIREMENT_UNREVIEWED");
}
console.log(
  `WORKROOM_UNIT_DISPOSITION_VERIFIED ${expected.length} retired chrome files; all other default unit files retained.`,
);
