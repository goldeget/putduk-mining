import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export function parseGitBlobBatch(bytes, names) {
  if (
    !Buffer.isBuffer(bytes) ||
    !names.length ||
    new Set(names).size !== names.length
  )
    throw Error("WORKROOM_GIT_BATCH_REQUESTS");
  const result = new Map();
  let cursor = 0;
  for (const name of names) {
    const end = bytes.indexOf(10, cursor);
    if (end < cursor || end - cursor > 120)
      throw Error("WORKROOM_GIT_BATCH_HEADER");
    const header = bytes.subarray(cursor, end);
    if (header.some((byte) => byte > 127))
      throw Error("WORKROOM_GIT_BATCH_HEADER");
    const match = /^([a-f0-9]{40}) blob (0|[1-9][0-9]*)$/.exec(
      header.toString("ascii"),
    );
    if (!match) throw Error("WORKROOM_GIT_BATCH_BLOB_REQUIRED");
    const size = Number(match[2]);
    cursor = end + 1;
    if (
      !Number.isSafeInteger(size) ||
      size > 20 * 1024 * 1024 ||
      cursor + size >= bytes.length ||
      bytes[cursor + size] !== 10
    )
      throw Error("WORKROOM_GIT_BATCH_SIZE_OR_DELIMITER");
    const body = bytes.subarray(cursor, cursor + size);
    const oid = createHash("sha1")
      .update(Buffer.from(`blob ${size}\0`))
      .update(body)
      .digest("hex");
    if (oid !== match[1]) throw Error("WORKROOM_GIT_BATCH_OBJECT_ID");
    result.set(name, body);
    cursor += size + 1;
  }
  if (cursor !== bytes.length) throw Error("WORKROOM_GIT_BATCH_TRAILING_BYTES");
  return result;
}

export function readGitBlobs(root, revision, names) {
  if (
    !/^[a-f0-9]{40}$/.test(revision) ||
    names.some((name) => !name || /[\r\n\0]/.test(name))
  )
    throw Error("WORKROOM_GIT_BATCH_REQUESTS");
  const bytes = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: names.map((name) => `${revision}:${name}\n`).join(""),
    maxBuffer: 40 * 1024 * 1024,
  });
  return parseGitBlobBatch(bytes, names);
}
