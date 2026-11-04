import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalSourceBytes } from "./ci-workroom-source-bytes.mjs";
test("reviewed text types have identical Windows checkout and Linux Git bytes", () => {
  for (const path of [
    "rules/example.mdc",
    "inventory.csv",
    "scripts/example.ps1",
    "scripts/example.py",
    "scripts/example.sh",
    ".github/CODEOWNERS",
    "app/example.tsx",
    "supabase/example.sql",
  ]) {
    const linux = Buffer.from("첫 번째 줄\nsecond line\n");
    const windows = Buffer.from("첫 번째 줄\r\nsecond line\r\n");
    assert.deepEqual(
      canonicalSourceBytes(path, windows),
      canonicalSourceBytes(path, linux),
      path,
    );
    assert.notDeepEqual(
      canonicalSourceBytes(path, linux),
      canonicalSourceBytes(path, Buffer.from("changed\n")),
      path,
    );
  }
});
test("binary and unreviewed formats keep exact bytes, including CRLF and NUL", () => {
  const bytes = Buffer.from([0x89, 0x50, 0x00, 0x0d, 0x0a, 0xff]);
  assert.strictEqual(canonicalSourceBytes("public/a.png", bytes), bytes);
  assert.strictEqual(canonicalSourceBytes("unreviewed.inc", bytes), bytes);
  assert.throws(() => canonicalSourceBytes("bad.py", bytes), /INVALID_UTF8/);
  assert.throws(
    () => canonicalSourceBytes("bad.sh", Buffer.from("a\0b")),
    /NUL_IN_TEXT/,
  );
});
