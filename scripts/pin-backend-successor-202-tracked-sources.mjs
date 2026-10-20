/** Root-reviewed index admission only. Never stages, commits, or discovers approvals. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { assertBackend202ManifestShape } from "./backend-successor-202-source.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAP = "tests/e2e/fixtures/backend-successor-202-source.json",
  GUARD = "scripts/backend-successor-202-source.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const need = (v, r) => {
  if (!v) throw Error("BACKEND202_PIN_" + r);
};
const git = (args, input) =>
  execFileSync("git", args, {
    cwd: ROOT,
    input,
    // Only stage metadata is buffered; blob content is streamed below.
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
  });
function utf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error("BACKEND202_PIN_INDEX_UTF8_REQUIRED");
  }
}
export function parseStaged202Index(raw) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.at(-1) === 0,
    "NUL_STAGE_ROSTER_REQUIRED",
  );
  const rows = [],
    paths = new Set();
  for (let start = 0; start < raw.length;) {
    const end = raw.indexOf(0, start),
      tab = raw.indexOf(9, start);
    need(end > start && tab > start && tab < end, "STAGE_RECORD_MALFORMED");
    const match = /^([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])$/.exec(
      utf8(raw.subarray(start, tab)),
    );
    need(match, "STAGE_RECORD_MALFORMED");
    const [, mode, oid, stage] = match,
      name = utf8(raw.subarray(tab + 1, end));
    need(stage === "0", "UNMERGED_INDEX_REJECTED");
    need(["100644", "100755"].includes(mode), "INDEX_REGULAR_FILE_REQUIRED");
    need(
      name &&
        !name.includes("\\") &&
        !name.includes(":") &&
        !name.startsWith("/") &&
        name.split("/").every((s) => s && s !== "." && s !== ".."),
      "PATH_REJECTED",
    );
    need(!paths.has(name), "DUPLICATE_INDEX_PATH_REJECTED");
    paths.add(name);
    rows.push({ mode, oid, path: name });
    start = end + 1;
  }
  need(
    rows.every((r) => r.oid.length === rows[0].oid.length),
    "INDEX_OBJECT_FORMAT_MISMATCH",
  );
  return rows;
}
export function create202BatchDigestParser(oids) {
  need(
    Array.isArray(oids) &&
      oids.length > 0 &&
      new Set(oids).size === oids.length &&
      oids.every((oid) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)),
    "EXACT_BATCH_REQUEST_REQUIRED",
  );
  const blobs = new Map();
  let index = 0,
    phase = "header",
    header = Buffer.alloc(0),
    remaining = 0,
    size = 0,
    total = 0,
    sha256,
    objectHash;
  return {
    push(chunk) {
      need(Buffer.isBuffer(chunk), "BATCH_RAW_BUFFER_REQUIRED");
      total += chunk.length;
      need(total <= 512 * 1024 * 1024, "BATCH_TOTAL_SIZE_REJECTED");
      let at = 0;
      while (at < chunk.length) {
        need(index < oids.length, "BATCH_UNEXPECTED_TRAILING_BYTES");
        if (phase === "header") {
          const end = chunk.indexOf(10, at),
            stop = end < 0 ? chunk.length : end;
          need(header.length + stop - at <= 128, "BATCH_HEADER_TOO_LONG");
          header = Buffer.concat([header, chunk.subarray(at, stop)]);
          at = stop;
          if (end < 0) continue;
          at++;
          const match =
            /^([a-f0-9]{40}|[a-f0-9]{64}) blob (0|[1-9][0-9]*)$/.exec(
              utf8(header),
            );
          need(
            match && match[1] === oids[index],
            "BATCH_HEADER_OR_ORDER_MISMATCH",
          );
          size = Number(match[2]);
          need(
            Number.isSafeInteger(size) &&
              size >= 0 &&
              size <= 128 * 1024 * 1024,
            "BATCH_BLOB_SIZE_REJECTED",
          );
          remaining = size;
          sha256 = createHash("sha256");
          objectHash = createHash(
            oids[index].length === 40 ? "sha1" : "sha256",
          ).update(Buffer.from(`blob ${size}\0`));
          header = Buffer.alloc(0);
          phase = remaining ? "data" : "trailer";
        } else if (phase === "data") {
          const length = Math.min(remaining, chunk.length - at),
            bytes = chunk.subarray(at, at + length);
          sha256.update(bytes);
          objectHash.update(bytes);
          remaining -= length;
          at += length;
          if (!remaining) phase = "trailer";
        } else {
          need(chunk[at++] === 10, "BATCH_BLOB_TRAILER_REJECTED");
          need(
            objectHash.digest("hex") === oids[index],
            "BATCH_RAW_BLOB_OID_MISMATCH",
          );
          blobs.set(
            oids[index],
            Object.freeze({ sha256: sha256.digest("hex"), bytes: size }),
          );
          index++;
          phase = "header";
        }
      }
    },
    finish() {
      need(
        index === oids.length && phase === "header" && header.length === 0,
        "BATCH_TRUNCATED",
      );
      return blobs;
    },
  };
}
export function parse202BatchBlobs(raw, oids) {
  const parser = create202BatchDigestParser(oids);
  parser.push(raw);
  return parser.finish();
}
function streamGitBatch(oids, onChunk) {
  return new Promise((resolveBatch, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let failure,
      stderrBytes = 0,
      settled = false;
    const fail = (code) => {
      failure ??= Error("BACKEND202_PIN_" + code);
      child.kill();
    };
    const timer = setTimeout(() => fail("BATCH_TIMEOUT"), 60000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveBatch();
    };
    child.stdout.on("data", (chunk) => {
      if (failure) return;
      try {
        onChunk(chunk);
      } catch (error) {
        failure = error;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) fail("BATCH_STDERR_LIMIT");
    });
    child.once("error", () =>
      finish(Error("BACKEND202_PIN_BATCH_PROCESS_FAILED")),
    );
    child.once("close", (code, signal) =>
      finish(
        failure ??
          (code !== 0 || signal
            ? Error("BACKEND202_PIN_BATCH_PROCESS_FAILED")
            : undefined),
      ),
    );
    child.stdin.on("error", () => fail("BATCH_INPUT_FAILED"));
    child.stdin.end(Buffer.from(oids.join("\n") + "\n"));
  });
}
export async function read202IndexSnapshot(
  runGit = git,
  streamBatch = streamGitBatch,
) {
  const args = ["ls-files", "--cached", "--stage", "-z"],
    raw = Buffer.from(runGit(args));
  const rows = parseStaged202Index(raw),
    oids = [...new Set(rows.map((r) => r.oid))];
  const parser = create202BatchDigestParser(oids);
  await streamBatch(oids, (chunk) => parser.push(chunk));
  const blobs = parser.finish();
  const byPath = new Map(rows.map((r) => [r.path, r.oid]));
  return {
    names: rows.map((r) => r.path),
    readIndexSha256: (p) => {
      need(byPath.has(p), "INDEX_PATH_MISSING");
      return blobs.get(byPath.get(p)).sha256;
    },
    assertUnchanged: () =>
      need(raw.equals(runGit(args)), "INDEX_CHANGED_DURING_PIN"),
  };
}
function validateReviewed202Digests(roster, names, readDigest) {
  need(
    roster?.state === "OWNER_REVIEWED_EXACT_INDEX_ROSTER" &&
      roster.revision === 202 &&
      /^[a-f0-9]{64}$/.test(roster.reviewReceiptSha256 || ""),
    "OWNER_REVIEW_REQUIRED",
  );
  need(
    roster.sourceHashes &&
      typeof roster.sourceHashes === "object" &&
      !Array.isArray(roster.sourceHashes),
    "SOURCE_ROSTER_REQUIRED",
  );
  const paths = Object.keys(roster.sourceHashes);
  need(
    JSON.stringify([...paths, MAP, GUARD].sort()) ===
      JSON.stringify([...names].sort()),
    "COMPLETE_INDEX_ROSTER_REQUIRED",
  );
  for (const p of paths) {
    need(
      !p.includes("\\") &&
        !p.includes(":") &&
        !p.startsWith("/") &&
        p.split("/").every((s) => s && s !== "." && s !== ".."),
      "PATH_REJECTED",
    );
    need(
      /^[a-f0-9]{64}$/.test(roster.sourceHashes[p]) &&
        readDigest(p) === roster.sourceHashes[p],
      "REVIEWED_INDEX_BYTES_CHANGED",
    );
  }
  return { ...roster.sourceHashes };
}
export function validateReviewed202Roster(roster, names, readIndex) {
  return validateReviewed202Digests(roster, names, (p) => hash(readIndex(p)));
}
export async function pinReviewed202Index(args) {
  need(
    args.length === 1 && args[0].startsWith("--reviewed-roster="),
    "EXPLICIT_REVIEWED_ROSTER_REQUIRED",
  );
  const roster = JSON.parse(
    readFileSync(resolve(args[0].slice("--reviewed-roster=".length)), "utf8"),
  );
  const snapshot = await read202IndexSnapshot();
  const m = JSON.parse(readFileSync(resolve(ROOT, MAP), "utf8"));
  m.sourceHashes = validateReviewed202Digests(
    roster,
    snapshot.names,
    snapshot.readIndexSha256,
  );
  for (const p of Object.keys(m.browserConsumerHashes))
    m.browserConsumerHashes[p] = m.sourceHashes[p];
  m.admissionState = "REVIEWED_FINAL_INDEX_PINNED";
  assertBackend202ManifestShape(m);
  // Historical 201 scripts/configs are immutable leaves too, including its pin builder.
  const old = JSON.parse(
    readFileSync(
      resolve(ROOT, "tests/e2e/fixtures/backend-successor-201-source.json"),
      "utf8",
    ),
  );
  for (const [p, h] of Object.entries(old.sourceHashes))
    if (/(?:scripts\/[^/]*201[^/]*|playwright\.[^/]*201[^/]*\.ts)$/.test(p))
      need(m.sourceHashes[p] === h, "HISTORICAL_201_LEAF_CHANGED");
  const bytes = Buffer.from(JSON.stringify(m, null, 2) + "\n");
  const guard = readFileSync(resolve(ROOT, GUARD), "utf8");
  const next = guard.replace(
    /const MANIFEST_SHA256 =\r?\n  "[a-f0-9]{64}";/,
    'const MANIFEST_SHA256 =\n  "' + hash(bytes) + '";',
  );
  need(
    next !== guard || guard.includes('"' + hash(bytes) + '"'),
    "GUARD_LITERAL_REQUIRED",
  );
  snapshot.assertUnchanged();
  writeFileSync(resolve(ROOT, MAP), bytes);
  writeFileSync(resolve(ROOT, GUARD), next);
  return {
    state: "WORKTREE_PIN_PREPARED_ROOT_MUST_STAGE_AND_VERIFY",
    manifestSha256: hash(bytes),
    sourceCount: Object.keys(m.sourceHashes).length,
    reviewReceiptSha256: roster.reviewReceiptSha256,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  try {
    console.log(
      JSON.stringify(await pinReviewed202Index(process.argv.slice(2))),
    );
  } catch (error) {
    console.error(
      /^BACKEND202_PIN_[A-Z0-9_]+$/.test(error?.message ?? "")
        ? error.message
        : "BACKEND202_PIN_FAILED",
    );
    process.exitCode = 1;
  }
