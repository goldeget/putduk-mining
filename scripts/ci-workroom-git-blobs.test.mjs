import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseGitBlobBatch } from "./ci-workroom-git-blobs.mjs";
const frame = (body) =>
  Buffer.concat([
    Buffer.from(
      `${createHash("sha1")
        .update(Buffer.from(`blob ${body.length}\0`))
        .update(body)
        .digest("hex")} blob ${body.length}\n`,
    ),
    body,
    Buffer.from("\n"),
  ]);
test("preserves CRLF, NUL and newline body bytes in ordered batch records", () => {
  const a = Buffer.from("a\r\n\0b\n"),
    b = Buffer.alloc(0);
  const result = parseGitBlobBatch(Buffer.concat([frame(a), frame(b)]), [
    "a.sql",
    "b.sql",
  ]);
  assert.deepEqual(result.get("a.sql"), a);
  assert.deepEqual(result.get("b.sql"), b);
});
test("rejects missing, truncated, non-blob, altered and extra batch data", () => {
  const good = frame(Buffer.from("hello"));
  for (const bad of [
    good.subarray(0, -1),
    Buffer.concat([good, Buffer.from("extra")]),
    Buffer.from("a.sql missing\n"),
    Buffer.from(good.toString().replace(" blob ", " tree ")),
    Buffer.from(good.toString().replace("hello", "jello")),
    Buffer.from(good.toString().replace("blob 5", "blob 6")),
  ])
    assert.throws(() => parseGitBlobBatch(bad, ["a.sql"]));
  assert.throws(() => parseGitBlobBatch(good, ["a.sql", "a.sql"]));
});
