/** Stage exact historical content as test fixtures only. Import starts no Git/network operation. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPOSITORY = "goldeget/putduk-mining";
const ORIGIN = "https://github.com/goldeget/putduk-mining.git";
const REVISION = "ba9ed931f756488ce4f67f945cffad9552842c09";
const PREFIX = "launch-content/";
const SOURCE = "domain/content/source-preview.ts";
const FAQ_SOURCE = "domain/content/faq.ts";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const need = (value, reason) => {
  if (!value) throw Error("CONTENT_SOURCE_CI_" + reason);
};

function declaration(source, name) {
  const found = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const node of statement.declarationList.declarations) {
      if (ts.isIdentifier(node.name) && node.name.text === name) {
        need(
          statement.modifiers?.some(
            (item) => item.kind === ts.SyntaxKind.ExportKeyword,
          ) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0,
          "EXPORTED_CONST_REQUIRED",
        );
        found.push(node.initializer);
      }
    }
  }
  need(found.length === 1 && found[0], "UNIQUE_DECLARATION_REQUIRED");
  return found[0];
}

function stringLiteral(node) {
  need(node && ts.isStringLiteral(node), "LITERAL_STRING_REQUIRED");
  return node.text;
}

function isFreeze(node) {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Object" &&
    node.expression.name.text === "freeze"
  );
}

export function assertContentFixturePath(path) {
  need(
    typeof path === "string" &&
      path.length > 0 &&
      path.length <= 100 &&
      !isAbsolute(path) &&
      !/[\\:\r\n\0]/.test(path) &&
      path
        .split("/")
        .every(
          (part) =>
            /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..",
        ),
    "PIN_PATH_REJECTED",
  );
  return path;
}

/** Read the existing closed literal declarations without evaluating product code or copying pins. */
export function readContentSourcePins(sourceText, faqText) {
  const source = ts.createSourceFile(
    SOURCE,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const faq = ts.createSourceFile(
    FAQ_SOURCE,
    faqText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  need(
    source.parseDiagnostics.length === 0 && faq.parseDiagnostics.length === 0,
    "DECLARATION_PARSE_FAILED",
  );
  const revision = stringLiteral(
    declaration(source, "CONTENT_SOURCE_REVISION"),
  );
  const repository = stringLiteral(
    declaration(source, "CONTENT_SOURCE_REPOSITORY"),
  );
  need(
    revision === REVISION && repository === REPOSITORY,
    "EXACT_SOURCE_IDENTITY_REQUIRED",
  );
  const faqDigest = stringLiteral(
    declaration(faq, "ORIGINAL_FAQ_SOURCE_DIGEST"),
  );
  need(/^[a-f0-9]{64}$/.test(faqDigest), "FAQ_DIGEST_REQUIRED");
  const frozen = declaration(source, "CONTENT_SOURCE_PINS");
  need(isFreeze(frozen), "CLOSED_PIN_DECLARATION_REQUIRED");
  const mapped = frozen.arguments[0];
  need(
    ts.isCallExpression(mapped) &&
      mapped.arguments.length === 1 &&
      ts.isPropertyAccessExpression(mapped.expression) &&
      mapped.expression.name.text === "map" &&
      ts.isArrayLiteralExpression(mapped.expression.expression),
    "CLOSED_PIN_DECLARATION_REQUIRED",
  );
  const callback = mapped.arguments[0];
  need(
    ts.isArrowFunction(callback) &&
      callback.parameters.length === 1 &&
      ts.isIdentifier(callback.parameters[0].name) &&
      callback.parameters[0].name.text === "pin" &&
      isFreeze(callback.body) &&
      ts.isAsExpression(callback.body.arguments[0]) &&
      ts.isIdentifier(callback.body.arguments[0].expression) &&
      callback.body.arguments[0].expression.text === "pin" &&
      ts.isTypeReferenceNode(callback.body.arguments[0].type) &&
      ts.isIdentifier(callback.body.arguments[0].type.typeName) &&
      callback.body.arguments[0].type.typeName.text === "SourcePin",
    "CLOSED_PIN_CALLBACK_REQUIRED",
  );
  const fields = ["bytes", "gitBlobSha", "itemCount", "kind", "path", "sha256"];
  const pins = mapped.expression.expression.elements.map((entry) => {
    need(ts.isObjectLiteralExpression(entry), "PIN_OBJECT_REQUIRED");
    const values = Object.create(null);
    for (const field of entry.properties) {
      need(
        ts.isPropertyAssignment(field) &&
          ts.isIdentifier(field.name) &&
          fields.includes(field.name.text) &&
          !Object.hasOwn(values, field.name.text),
        "PIN_FIELDS_REQUIRED",
      );
      const name = field.name.text,
        value = field.initializer;
      if (name === "bytes" || name === "itemCount") {
        need(
          ts.isNumericLiteral(value) && /^(0|[1-9][0-9]*)$/.test(value.text),
          "PIN_INTEGER_REQUIRED",
        );
        values[name] = Number(value.text);
      } else if (
        name === "sha256" &&
        ts.isIdentifier(value) &&
        value.text === "ORIGINAL_FAQ_SOURCE_DIGEST"
      ) {
        values[name] = faqDigest;
      } else values[name] = stringLiteral(value);
    }
    need(
      JSON.stringify(Object.keys(values).sort()) === JSON.stringify(fields),
      "PIN_FIELDS_REQUIRED",
    );
    assertContentFixturePath(values.path);
    need(
      Number.isSafeInteger(values.bytes) &&
        values.bytes > 0 &&
        values.bytes <= 200_000 &&
        Number.isSafeInteger(values.itemCount) &&
        values.itemCount >= 0 &&
        /^[a-f0-9]{64}$/.test(values.sha256) &&
        /^[a-f0-9]{40}$/.test(values.gitBlobSha) &&
        ["REFERENCE", "EVENT", "NOTICE", "FAQ"].includes(values.kind),
      "PIN_TUPLE_REQUIRED",
    );
    return Object.freeze(values);
  });
  need(
    pins.length === 13 && new Set(pins.map((pin) => pin.path)).size === 13,
    "EXACT_THIRTEEN_PINS_REQUIRED",
  );
  return Object.freeze({
    revision,
    repository,
    sourcePrefix: PREFIX,
    pins: Object.freeze(pins),
  });
}

export function verifyContentSourceBlob(pin, bytes, mappedBlobSha) {
  need(
    Buffer.isBuffer(bytes) && bytes.length === pin.bytes,
    "BLOB_SIZE_MISMATCH",
  );
  need(mappedBlobSha === pin.gitBlobSha, "COMMIT_PATH_BLOB_MISMATCH");
  const sha256 = hash(bytes);
  const gitBlobSha = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
  need(
    sha256 === pin.sha256 && gitBlobSha === pin.gitBlobSha,
    "BLOB_HASH_MISMATCH",
  );
  return Object.freeze({
    path: pin.path,
    bytes: bytes.length,
    sha256,
    gitBlobSha,
  });
}

/** Validate a single bounded tree listing, never guess alternate source prefixes. */
export function verifyContentSourceTree(raw, pins) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 256_000,
    "BOUNDED_TREE_REQUIRED",
  );
  const entries = new Map();
  for (const row of raw.toString("utf8").split("\0").filter(Boolean)) {
    const match =
      /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(
        row,
      );
    need(match && !entries.has(match[4]), "TREE_ENTRY_REJECTED");
    entries.set(match[4], {
      mode: match[1],
      type: match[2],
      blobSha: match[3],
    });
  }
  return pins.map((pin) => {
    const entry = entries.get(PREFIX + assertContentFixturePath(pin.path));
    need(
      entry?.mode === "100644" &&
        entry.type === "blob" &&
        entry.blobSha === pin.gitBlobSha,
      "EXACT_PREFIX_TREE_PIN_REQUIRED",
    );
    return Object.freeze({
      path: pin.path,
      commitPath: `${REVISION}:${PREFIX}${pin.path}`,
      blobSha: entry.blobSha,
    });
  });
}

export function assertContentSourceCiContext(env, origin, checkoutSha) {
  need(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_JOB === "application" &&
      ["push", "pull_request"].includes(env.GITHUB_EVENT_NAME),
    "EXACT_CI_CONTEXT_REQUIRED",
  );
  need(origin === ORIGIN, "EXACT_ORIGIN_REQUIRED");
  need(
    /^[a-f0-9]{40}$/.test(checkoutSha) &&
      env.GITHUB_SHA === checkoutSha &&
      /^[0-9]+$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "EXACT_CI_RUN_REQUIRED",
  );
  need(
    typeof env.RUNNER_TEMP === "string" &&
      isAbsolute(env.RUNNER_TEMP) &&
      !/[\r\n\0]/.test(env.RUNNER_TEMP),
    "RUNNER_TEMP_REQUIRED",
  );
}

export function contentSourceFetchArgs() {
  need(arguments.length === 0, "FETCH_CALLER_OPTIONS_REJECTED");
  return Object.freeze([
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
    REVISION,
  ]);
}

function realOwned(path, parent, file = false) {
  need(isAbsolute(path), "ABSOLUTE_PATH_REQUIRED");
  const resolved = resolve(path),
    rel = relative(parent, resolved);
  need(
    rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep),
    "OWNED_PATH_REQUIRED",
  );
  let at = parent;
  for (const part of rel.split(sep)) {
    at = resolve(at, part);
    need(!lstatSync(at).isSymbolicLink(), "SOURCE_LINK_REJECTED");
  }
  need(
    realpathSync(resolved) === resolved &&
      (!file || lstatSync(resolved).isFile()),
    "REAL_REGULAR_PATH_REQUIRED",
  );
  return resolved;
}

function main() {
  need(process.argv.length === 2, "NO_ARGUMENTS_REQUIRED");
  const root = realpathSync(ROOT);
  const env = {
    ...process.env,
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (args, { maxBuffer = 512_000, timeout = 20_000 } = {}) =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: root,
      env,
      maxBuffer,
      timeout,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const text = (args) => git(args).toString("utf8").trim();
  const origin = text(["remote", "get-url", "origin"]),
    checkoutSha = text(["rev-parse", "HEAD"]);
  assertContentSourceCiContext(env, origin, checkoutSha);
  need(
    realpathSync(text(["rev-parse", "--show-toplevel"])) === root,
    "EXACT_CHECKOUT_REQUIRED",
  );
  // Configured URL rewriting could redirect an otherwise approved origin.
  let rewrites;
  try {
    rewrites = text(["config", "--get-regexp", "^url\\..*\\.insteadof$"]);
  } catch (error) {
    need(error.status === 1, "GIT_CONFIG_READ_FAILED");
    rewrites = "";
  }
  need(!rewrites, "URL_REWRITE_REJECTED");
  const temp = realpathSync(env.RUNNER_TEMP);
  need(
    temp === resolve(env.RUNNER_TEMP) && !lstatSync(temp).isSymbolicLink(),
    "REAL_RUNNER_TEMP_REQUIRED",
  );
  need(typeof env.GITHUB_ENV === "string", "GITHUB_ENV_REQUIRED");
  const envFile = realOwned(env.GITHUB_ENV, temp, true);
  const outputFile = env.GITHUB_OUTPUT
    ? realOwned(env.GITHUB_OUTPUT, temp, true)
    : null;
  const sourceBytes = readFileSync(
    realOwned(resolve(root, SOURCE), root, true),
  );
  const faqBytes = readFileSync(
    realOwned(resolve(root, FAQ_SOURCE), root, true),
  );
  const declared = readContentSourcePins(
    sourceBytes.toString("utf8"),
    faqBytes.toString("utf8"),
  );
  const output = mkdtempSync(resolve(temp, "putduk-content-source-"));
  realOwned(output, temp);
  const startedAt = Date.now();
  const shallowBefore = text(["rev-parse", "--is-shallow-repository"]);
  need(["true", "false"].includes(shallowBefore), "SHALLOW_STATE_REQUIRED");
  let fetched = false;
  try {
    try {
      need(
        text(["cat-file", "-t", REVISION]) === "commit",
        "EXACT_COMMIT_REQUIRED",
      );
    } catch (error) {
      need(
        error.status === 128 || error.status === 1,
        "LOCAL_COMMIT_PROBE_FAILED",
      );
      // No branch, wildcard, redirect, other host, or other repository is fetched.
      need(
        text(["remote", "get-url", "origin"]) === ORIGIN,
        "EXACT_ORIGIN_REQUIRED",
      );
      git(contentSourceFetchArgs(), { timeout: 60_000, maxBuffer: 512_000 });
      fetched = true;
    }
    need(
      text(["cat-file", "-t", REVISION]) === "commit",
      "EXACT_COMMIT_REQUIRED",
    );
    const shallowAfter = text(["rev-parse", "--is-shallow-repository"]);
    need(shallowAfter === shallowBefore, "SHALLOW_BOUNDARY_CHANGED");
    const treeSha = text(["rev-parse", "--verify", REVISION + "^{tree}"]);
    need(/^[a-f0-9]{40}$/.test(treeSha), "COMMIT_TREE_REQUIRED");
    const treeBytes = git(
      ["ls-tree", "-r", "-z", REVISION, "--", PREFIX.slice(0, -1)],
      { maxBuffer: 256_000 },
    );
    const mappings = verifyContentSourceTree(treeBytes, declared.pins);
    const blobs = declared.pins.map((pin, index) => {
      const mapping = mappings[index];
      need(
        text(["rev-parse", "--verify", mapping.commitPath]) === pin.gitBlobSha,
        "COMMIT_PATH_BLOB_MISMATCH",
      );
      const bytes = git(["cat-file", "blob", pin.gitBlobSha], {
        maxBuffer: 200_000,
      });
      return {
        pin,
        mapping,
        bytes,
        proof: verifyContentSourceBlob(pin, bytes, mapping.blobSha),
      };
    });
    // All 13 objects are verified before any original content is written.
    const raw = resolve(output, "raw");
    mkdirSync(raw);
    const files = blobs.map(({ pin, mapping, bytes, proof }) => {
      const destination = resolve(raw, pin.path);
      need(
        relative(raw, destination) &&
          !relative(raw, destination).startsWith(".." + sep),
        "OUTPUT_PATH_REJECTED",
      );
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
      realOwned(destination, output, true);
      const readback = readFileSync(destination);
      need(readback.equals(bytes), "EXTRACTED_READBACK_MISMATCH");
      return {
        ...proof,
        commitPath: mapping.commitPath,
        extractedSha256: hash(readback),
      };
    });
    need(
      text(["rev-parse", "HEAD"]) === checkoutSha &&
        text(["remote", "get-url", "origin"]) === origin &&
        readFileSync(resolve(root, SOURCE)).equals(sourceBytes) &&
        readFileSync(resolve(root, FAQ_SOURCE)).equals(faqBytes),
      "SOURCE_CHANGED_DURING_STAGING",
    );
    const receipt = resolve(output, "fixture-receipt.json");
    const report = {
      kind: "EXACT_CONTENT_SOURCE_CI_FIXTURES",
      state: "FIXTURES_STAGED_TESTS_NOT_EXECUTED",
      repository: REPOSITORY,
      checkoutSha,
      sourceRevision: REVISION,
      sourcePrefix: PREFIX,
      treeSha,
      runId: env.GITHUB_RUN_ID,
      attempt: Number(env.GITHUB_RUN_ATTEMPT),
      fetchedExactSourceCommit: fetched,
      sourceDeclarationSha256: hash(sourceBytes),
      shallowRepositoryBefore: shallowBefore,
      shallowRepositoryAfter: shallowAfter,
      faqDeclarationSha256: hash(faqBytes),
      treeListingSha256: hash(treeBytes),
      rawFixtureDirectory: raw,
      files,
      startedAt,
      finishedAt: Date.now(),
      originalContentExecuted: false,
      originalCopyAdoptedIntoProduct: false,
      canPublish: false,
      canExecute: false,
      testsExecuted: 0,
      release: "NOT_VERIFIED",
    };
    writeFileSync(receipt, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    realOwned(receipt, output, true);
    // GitHub-provided command files must remain inside RUNNER_TEMP and not be links.
    realOwned(envFile, temp, true);
    appendFileSync(envFile, `PUTDUK_CONTENT_SOURCE_FIXTURE_DIR=${raw}\n`);
    if (outputFile) {
      realOwned(outputFile, temp, true);
      appendFileSync(outputFile, `fixture_dir=${raw}\nreceipt=${receipt}\n`);
    }
    console.log(
      JSON.stringify({
        state: report.state,
        files: files.length,
        fixtureDirectory: raw,
        receipt,
        receiptSha256: hash(readFileSync(receipt)),
      }),
    );
  } catch (error) {
    const reason = /^CONTENT_SOURCE_CI_[A-Z0-9_]+$/.test(error?.message ?? "")
      ? error.message
      : "CONTENT_SOURCE_CI_UNCONFIRMED";
    writeFileSync(
      resolve(output, "failure.json"),
      JSON.stringify({
        state: "FAILED_STAGING_STEP",
        reason,
        repository: REPOSITORY,
        sourceRevision: REVISION,
        checkoutSha,
        fetchedExactSourceCommit: fetched,
        startedAt,
        finishedAt: Date.now(),
      }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    throw Error(reason);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(
      /^CONTENT_SOURCE_CI_[A-Z0-9_]+$/.test(error?.message ?? "")
        ? error.message
        : "CONTENT_SOURCE_CI_UNCONFIRMED",
    );
    process.exitCode = 1;
  }
}
