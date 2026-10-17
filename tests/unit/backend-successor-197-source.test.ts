import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertBackend197CanonicalSources as canonical,
  assertBackend197LocalSources as local,
} from "../../scripts/backend-successor-197-source.mjs";
const ROOT = process.cwd(),
  PREFIX = "putduk-backend197-unit-",
  scratch = realpathSync(tmpdir()),
  roots: string[] = [];
const digest = (x: Buffer | string) =>
  createHash("sha256").update(x).digest("hex");
const mapPath = "tests/e2e/fixtures/backend-successor-197-source.json";
const history = [
  "principal-review-r2-ci-source.json",
  "principal-backend-engine-187-source.json",
  "principal-backend-first-188-source.json",
  "principal-backend-first-191-source.json",
  "backend-http-local-193-source.json",
  "backend-http-195-source.json",
];
function fixture(mode: "canonical" | "local" = "canonical") {
  const root = realpathSync(mkdtempSync(resolve(scratch, PREFIX)));
  roots.push(root);
  const paths = new Set<string>([mapPath]);
  for (const name of history) {
    const path = "tests/e2e/fixtures/" + name;
    paths.add(path);
    const map = JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
    for (const row of [
      ...map.sources,
      ...(map.additionalRuntimeSources ?? []),
      ...(map.evidenceSources ?? []),
    ])
      paths.add(row.path);
  }
  const candidate = JSON.parse(readFileSync(resolve(ROOT, mapPath), "utf8"));
  for (const row of candidate.additionalSources) paths.add(row.path);
  for (const path of paths) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    copyFileSync(resolve(ROOT, path), resolve(root, path));
  }
  let config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
  if (
    mode === "canonical" &&
    digest(config) ===
      "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7"
  ) {
    config = config.replace(
      'project_id = "putduk-mining-backend-patch-20261011"',
      'project_id = "putduk-mining-ci-r2-20261009"',
    );
    for (const [from, to] of [
      [65421, 63421],
      [65422, 63422],
      [65420, 63420],
      [65429, 63429],
      [65423, 63423],
      [65424, 63424],
      [65427, 63427],
    ])
      config = config.replace("port = " + from, "port = " + to);
  }
  writeFileSync(resolve(root, "supabase/config.toml"), config);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(root) !== scratch || !basename(root).startsWith(PREFIX))
      throw Error("UNIT_ROOT_SCOPE");
    rmSync(root, { recursive: true, force: true });
  }
});
describe("successor197 exact source boundary (file fixtures; no DB/HTTP/Worker)", () => {
  it("accepts exactly canonical197 after reviewed pin, without implying launch", () =>
    expect(canonical(fixture())).toMatchObject({
      scope: "CANONICAL_CI",
      migrationSources: 197,
      runtimeSources: 33,
      apiPort: 63421,
      dbPort: 63422,
    }));
  it("accepts tasklocal through separate closed export only", () =>
    expect(local(fixture("local"))).toMatchObject({
      scope: "LOCAL_QA",
      migrationSources: 197,
      apiPort: 65421,
      dbPort: 65422,
    }));
  it("rejects local through canonical", () =>
    expect(() => canonical(fixture("local"))).toThrow("SOURCE_CHANGED"));
  it("rejects canonical through local", () =>
    expect(() => local(fixture())).toThrow("SOURCE_CHANGED"));
  it.each(history)("rejects changed immutable predecessor %s", (name) => {
    const root = fixture(),
      path = resolve(root, "tests/e2e/fixtures/" + name);
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
    expect(() => canonical(root)).toThrow("MANIFEST_CHANGED");
  });
  it.each([
    "workers/runner.mjs",
    "app/api/v1/ai/chat/route.ts",
    "scripts/usdt-manual-195-native-fixture-v3.mjs",
    "playwright.backend-http-197.config.ts",
  ])("rejects runtime/consumer delta %s", (name) => {
    const root = fixture(),
      path = resolve(root, name);
    writeFileSync(path, readFileSync(path, "utf8") + "\n//changed\n");
    expect(() => canonical(root)).toThrow("SOURCE_CHANGED");
  });
  it("rejects caller rehash of successor manifest", () => {
    const root = fixture(),
      path = resolve(root, mapPath);
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
    expect(() => canonical(root)).toThrow("MANIFEST_CHANGED");
  });
  it("rejects extra migration without accepting a later generation", () => {
    const root = fixture();
    writeFileSync(
      resolve(root, "supabase/migrations/20261012000000_unapproved.sql"),
      "select 1;",
    );
    expect(() => canonical(root)).toThrow("MIGRATION_INVENTORY_CHANGED");
  });
  it("rejects missing reviewed migration", () => {
    const root = fixture();
    rmSync(
      resolve(
        root,
        "supabase/migrations/20261011173637_safe_mode_closed_outbox_ack.sql",
      ),
    );
    expect(() => canonical(root)).toThrow("MIGRATION_INVENTORY_CHANGED");
  });
  it("rejects caller-selected hash/scope options", () =>
    expect(() =>
      Reflect.apply(canonical, null, [
        fixture(),
        { scope: "LOCAL_QA", sha256: "a".repeat(64) },
      ]),
    ).toThrow("CALLER_OPTIONS_REJECTED"));
  it("rejects an escaping source junction", () => {
    const root = fixture(),
      outside = realpathSync(mkdtempSync(resolve(scratch, PREFIX)));
    roots.push(outside);
    renameSync(resolve(root, "apps"), resolve(outside, "apps"));
    symlinkSync(resolve(outside, "apps"), resolve(root, "apps"), "junction");
    expect(() => canonical(root)).toThrow("PATH_REJECTED");
  });
  it("never treats environment override as approval", () => {
    const root = fixture(),
      path = resolve(root, mapPath);
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
    const old = process.env.PUTDUK_BACKEND197_SHA;
    try {
      process.env.PUTDUK_BACKEND197_SHA = digest(readFileSync(path));
      expect(() => canonical(root)).toThrow("MANIFEST_CHANGED");
    } finally {
      if (old === undefined) delete process.env.PUTDUK_BACKEND197_SHA;
      else process.env.PUTDUK_BACKEND197_SHA = old;
    }
  });
});
