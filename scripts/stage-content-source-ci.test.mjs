import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertContentFixturePath,
  assertContentSourceCiContext,
  contentSourceFetchArgs,
  readContentSourcePins,
  verifyContentSourceBlob,
  verifyContentSourceTree,
} from "./stage-content-source-ci.mjs";

const source = readFileSync(
  new URL("../domain/content/source-preview.ts", import.meta.url),
  "utf8",
);
const faq = readFileSync(
  new URL("../domain/content/faq.ts", import.meta.url),
  "utf8",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const oid = (bytes) =>
  createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
function syntheticPin(path = "events.json", bytes = Buffer.from("first\n")) {
  return {
    path,
    bytes: bytes.length,
    sha256: digest(bytes),
    gitBlobSha: oid(bytes),
    kind: "REFERENCE",
    itemCount: 0,
  };
}
const origin = "https://github.com/goldeget/putduk-mining.git";
const checkoutSha = "a".repeat(40);
const context = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "goldeget/putduk-mining",
  GITHUB_JOB: "application",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_SHA: checkoutSha,
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "1",
  RUNNER_TEMP:
    process.platform === "win32"
      ? "F:\\owned-runner-temp"
      : "/owned-runner-temp",
};

test("fetch admits only the source pin SHA and preserves the existing graph boundary and FETCH_HEAD", () => {
  const args = contentSourceFetchArgs();
  assert.deepEqual(args, [
    "-c",
    "http.followRedirects=false",
    "-c",
    "protocol.allow=never",
    "-c",
    "protocol.https.allow=always",
    "fetch",
    "--no-tags",
    "--no-recurse-submodules",
    "--no-write-fetch-head",
    "origin",
    readContentSourcePins(source, faq).revision,
  ]);
  assert.throws(
    () => contentSourceFetchArgs({ revision: "b".repeat(40) }),
    /FETCH_CALLER_OPTIONS_REJECTED/,
  );
});

test("reads the existing13 source tuples and imported FAQ digest without copied original content", () => {
  const declared = readContentSourcePins(source, faq);
  assert.equal(declared.repository, context.GITHUB_REPOSITORY);
  assert.equal(declared.sourcePrefix, "launch-content/");
  assert.equal(declared.pins.length, 13);
  assert.equal(
    declared.pins.reduce((sum, pin) => sum + pin.bytes, 0),
    398556,
  );
  assert.ok(
    Object.isFrozen(declared) &&
      Object.isFrozen(declared.pins) &&
      declared.pins.every(Object.isFrozen),
  );
  assert.equal(
    declared.pins.find((pin) => pin.path === "faq.json").sha256,
    /ORIGINAL_FAQ_SOURCE_DIGEST\s*=\s*"([a-f0-9]{64})"/.exec(faq)[1],
  );
});

test("rejects a changed source repository or source revision", () => {
  const declared = readContentSourcePins(source, faq);
  assert.throws(
    () =>
      readContentSourcePins(
        source.replace(declared.revision, "b".repeat(40)),
        faq,
      ),
    /EXACT_SOURCE_IDENTITY_REQUIRED/,
  );
  assert.throws(
    () =>
      readContentSourcePins(
        source.replace(declared.repository, "foreign/repo"),
        faq,
      ),
    /EXACT_SOURCE_IDENTITY_REQUIRED/,
  );
});

test("rejects duplicate declarations and a changed map callback", () => {
  assert.throws(
    () =>
      readContentSourcePins(
        source +
          '\nexport const CONTENT_SOURCE_REVISION = "' +
          "b".repeat(40) +
          '";',
        faq,
      ),
    /UNIQUE_DECLARATION_REQUIRED/,
  );
  assert.throws(
    () =>
      readContentSourcePins(
        source.replace(
          "Object.freeze(pin as SourcePin)",
          "Object.freeze({ ...pin, bytes: 1 })",
        ),
        faq,
      ),
    /CLOSED_PIN_CALLBACK_REQUIRED/,
  );
});

test("never evaluates a dynamic pin expression", () => {
  delete globalThis.__contentSourcePinEvaluated;
  const changed = source.replace(
    'path: "manifest.json"',
    'path: (() => { globalThis.__contentSourcePinEvaluated = true; return "manifest.json"; })()',
  );
  assert.throws(
    () => readContentSourcePins(changed, faq),
    /LITERAL_STRING_REQUIRED/,
  );
  assert.equal(globalThis.__contentSourcePinEvaluated, undefined);
});

test("rejects spread, duplicate path, altered tuple fields and malformed FAQ digest", () => {
  assert.throws(
    () =>
      readContentSourcePins(
        source.replace(
          'path: "manifest.json",',
          '...{}, path: "manifest.json",',
        ),
        faq,
      ),
    /PIN_FIELDS_REQUIRED/,
  );
  assert.throws(
    () =>
      readContentSourcePins(
        source.replace(
          'path: "manifest.json",',
          '__proto__: "injected", path: "manifest.json",',
        ),
        faq,
      ),
    /PIN_FIELDS_REQUIRED/,
  );
  assert.throws(
    () =>
      readContentSourcePins(
        source.replace('path: "events.json"', 'path: "manifest.json"'),
        faq,
      ),
    /EXACT_THIRTEEN_PINS_REQUIRED/,
  );
  assert.throws(
    () =>
      readContentSourcePins(source.replace("bytes: 2740", "bytes: -1"), faq),
    /PIN_INTEGER_REQUIRED/,
  );
  const alteredKind = source.replace('kind: "EVENT",', 'kind: "EXECUTE",');
  assert.notEqual(alteredKind, source);
  assert.equal(alteredKind.includes('kind: "EXECUTE",'), true);
  assert.throws(
    () => readContentSourcePins(alteredKind, faq),
    /PIN_TUPLE_REQUIRED/,
  );
  assert.throws(
    () =>
      readContentSourcePins(
        source,
        faq.replace(
          /(ORIGINAL_FAQ_SOURCE_DIGEST\s*=\s*)"[a-f0-9]{64}"/,
          '$1"invalid"',
        ),
      ),
    /FAQ_DIGEST_REQUIRED/,
  );
});

for (const path of [
  "../outside",
  "docs/../../outside",
  "/outside",
  "C:/outside",
  "docs\\outside",
  "docs//file",
  "./file",
  "docs/file\nother",
  "docs/file\0other",
]) {
  test("rejects unsafe fixture path " + JSON.stringify(path), () => {
    assert.throws(() => assertContentFixturePath(path), /PIN_PATH_REJECTED/);
  });
}

test("accepts a valid nested path without turning it into a command", () => {
  assert.equal(
    assertContentFixturePath("evidence/content-validation.json"),
    "evidence/content-validation.json",
  );
});

test("validates exact bytes, SHA256 and the real Git blob header digest", () => {
  const bytes = Buffer.from("first\n");
  const pin = syntheticPin("events.json", bytes);
  assert.deepEqual(verifyContentSourceBlob(pin, bytes, pin.gitBlobSha), {
    path: pin.path,
    bytes: pin.bytes,
    sha256: pin.sha256,
    gitBlobSha: pin.gitBlobSha,
  });
  assert.throws(
    () =>
      verifyContentSourceBlob(pin, Buffer.from("first\r\n"), pin.gitBlobSha),
    /BLOB_SIZE_MISMATCH/,
  );
  assert.throws(
    () => verifyContentSourceBlob(pin, Buffer.from("other\n"), pin.gitBlobSha),
    /BLOB_HASH_MISMATCH/,
  );
  assert.throws(
    () => verifyContentSourceBlob(pin, bytes, "b".repeat(40)),
    /COMMIT_PATH_BLOB_MISMATCH/,
  );
  assert.throws(
    () =>
      verifyContentSourceBlob(
        { ...pin, gitBlobSha: "b".repeat(40) },
        bytes,
        "b".repeat(40),
      ),
    /BLOB_HASH_MISMATCH/,
  );
});

test("requires every pin under exactly the observed launch-content prefix", () => {
  const pin = syntheticPin();
  const tree = Buffer.from(
    `100644 blob ${pin.gitBlobSha}\tlaunch-content/events.json\0`,
  );
  assert.equal(verifyContentSourceTree(tree, [pin])[0].blobSha, pin.gitBlobSha);
  for (const changed of [
    tree.toString().replace("launch-content/", "other/"),
    tree.toString().replace("100644", "100755"),
    tree.toString().replace("100644", "120000"),
    tree.toString().replace(pin.gitBlobSha, "b".repeat(40)),
  ])
    assert.throws(
      () => verifyContentSourceTree(Buffer.from(changed), [pin]),
      /EXACT_PREFIX_TREE_PIN_REQUIRED/,
    );
  assert.throws(
    () => verifyContentSourceTree(Buffer.concat([tree, tree]), [pin]),
    /TREE_ENTRY_REJECTED/,
  );
  assert.throws(
    () => verifyContentSourceTree(tree, [pin, syntheticPin("notices.json")]),
    /EXACT_PREFIX_TREE_PIN_REQUIRED/,
  );
  assert.throws(
    () => verifyContentSourceTree(Buffer.alloc(256001), [pin]),
    /BOUNDED_TREE_REQUIRED/,
  );
});

test("accepts only the exact application CI context; no local mode or alternate repository", () => {
  assert.doesNotThrow(() =>
    assertContentSourceCiContext(context, origin, checkoutSha),
  );
  for (const changes of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "foreign/repo" },
    { GITHUB_JOB: "database" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
  ])
    assert.throws(
      () =>
        assertContentSourceCiContext(
          { ...context, ...changes },
          origin,
          checkoutSha,
        ),
      /EXACT_CI_CONTEXT_REQUIRED/,
    );
  assert.throws(
    () =>
      assertContentSourceCiContext(
        context,
        "git@github.com:goldeget/putduk-mining.git",
        checkoutSha,
      ),
    /EXACT_ORIGIN_REQUIRED/,
  );
  for (const changes of [
    { GITHUB_SHA: "b".repeat(40) },
    { GITHUB_RUN_ID: "missing" },
    { GITHUB_RUN_ATTEMPT: "0" },
  ]) {
    assert.throws(
      () =>
        assertContentSourceCiContext(
          { ...context, ...changes },
          origin,
          checkoutSha,
        ),
      /EXACT_CI_RUN_REQUIRED/,
    );
  }
  for (const temp of ["relative", "", context.RUNNER_TEMP + "\nother"]) {
    assert.throws(
      () =>
        assertContentSourceCiContext(
          { ...context, RUNNER_TEMP: temp },
          origin,
          checkoutSha,
        ),
      /RUNNER_TEMP_REQUIRED/,
    );
  }
});
