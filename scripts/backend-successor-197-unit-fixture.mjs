import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const SOURCE_SHA =
  "75fc0372de6c4c9c1500614e12502daf8ac7cf6ea6672b46d92dbe00352517dc";
const ORIGINAL_FIXTURE =
  'function fixture(mode: "canonical" | "local" = "canonical") {\n  const root = realpathSync(mkdtempSync(resolve(scratch, PREFIX)));\n  roots.push(root);\n  const paths = new Set<string>([mapPath]);\n  for (const name of history) {\n    const path = "tests/e2e/fixtures/" + name;\n    paths.add(path);\n    const map = JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));\n    for (const row of [\n      ...map.sources,\n      ...(map.additionalRuntimeSources ?? []),\n      ...(map.evidenceSources ?? []),\n    ])\n      paths.add(row.path);\n  }\n  const candidate = JSON.parse(readFileSync(resolve(ROOT, mapPath), "utf8"));\n  for (const row of candidate.additionalSources) paths.add(row.path);\n  for (const path of paths) {\n    mkdirSync(dirname(resolve(root, path)), { recursive: true });\n    copyFileSync(resolve(ROOT, path), resolve(root, path));\n  }\n  let config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");\n  if (\n    mode === "canonical" &&\n    digest(config) ===\n      "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7"\n  ) {\n    config = config.replace(\n      \'project_id = "putduk-mining-backend-patch-20261011"\',\n      \'project_id = "putduk-mining-ci-r2-20261009"\',\n    );\n    for (const [from, to] of [\n      [65421, 63421],\n      [65422, 63422],\n      [65420, 63420],\n      [65429, 63429],\n      [65423, 63423],\n      [65424, 63424],\n      [65427, 63427],\n    ])\n      config = config.replace("port = " + from, "port = " + to);\n  }\n  writeFileSync(resolve(root, "supabase/config.toml"), config);\n  return root;\n}\n';
const STAGED_FIXTURE =
  'const stagedFixture = prepareBackend197UnitFixtures(ROOT, scratch, PREFIX, roots);\nbeforeEach(() => stagedFixture.prepare());\nfunction fixture(mode: "canonical" | "local" = "canonical") {\n  return stagedFixture.root(mode);\n}\n';
const IMPORT =
  'import { prepareBackend197UnitFixtures } from "../../scripts/backend-successor-197-unit-fixture.mjs";\n';
const digest = (x) => createHash("sha256").update(x).digest("hex");
export function stageBackend197UnitFixtureSource(source) {
  if (
    digest(source) !== SOURCE_SHA ||
    source.split(ORIGINAL_FIXTURE).length !== 2
  )
    throw Error("BACKEND197_UNIT_ORIGINAL_CHANGED");
  const staged =
    IMPORT +
    source
      .replace("  copyFileSync,\n", "")
      .replace(
        'import { afterEach, describe, expect, it } from "vitest";',
        'import { afterEach, beforeEach, describe, expect, it } from "vitest";',
      )
      .replace(ORIGINAL_FIXTURE, STAGED_FIXTURE);
  const inverse = staged
    .slice(IMPORT.length)
    .replace(STAGED_FIXTURE, ORIGINAL_FIXTURE)
    .replace(
      'import { afterEach, beforeEach, describe, expect, it } from "vitest";',
      'import { afterEach, describe, expect, it } from "vitest";',
    )
    .replace(
      "import {\n  mkdirSync,",
      "import {\n  copyFileSync,\n  mkdirSync,",
    );
  if (digest(inverse) !== SOURCE_SHA)
    throw Error("BACKEND197_UNIT_INVERSE_MISMATCH");
  return staged;
}
export function backend197UnitFixturePlugin() {
  const target = fileURLToPath(
    new URL(
      "../tests/unit/backend-successor-197-source.test.ts",
      import.meta.url,
    ),
  ).replaceAll("\\", "/");
  return {
    name: "putduk197-exact-unit-fixture-stage",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0].replaceAll("\\", "/") !== target) return;
      return { code: stageBackend197UnitFixtureSource(code), map: null };
    },
  };
}
const LOCAL =
    "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7",
  CANONICAL =
    "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac";
export function backend197UnitConfigPair(source) {
  const current = digest(source);
  if (current !== LOCAL && current !== CANONICAL)
    throw Error("BACKEND197_UNIT_CONFIG_CHANGED");
  const replaceOnce = (s, a, b) => {
    if (s.split(a).length !== 2) throw Error("BACKEND197_UNIT_CONFIG_SPAN");
    return s.replace(a, b);
  };
  const convert = (s, toLocal) => {
    s = replaceOnce(
      s,
      toLocal
        ? 'project_id = "putduk-mining-ci-r2-20261009"'
        : 'project_id = "putduk-mining-backend-patch-20261011"',
      toLocal
        ? 'project_id = "putduk-mining-backend-patch-20261011"'
        : 'project_id = "putduk-mining-ci-r2-20261009"',
    );
    for (const [local, canonical] of [
      [65421, 63421],
      [65422, 63422],
      [65420, 63420],
      [65429, 63429],
      [65423, 63423],
      [65424, 63424],
      [65427, 63427],
    ])
      s = replaceOnce(
        s,
        "port = " + (toLocal ? canonical : local),
        "port = " + (toLocal ? local : canonical),
      );
    return s;
  };
  const local = current === LOCAL ? source : convert(source, true),
    canonical = current === CANONICAL ? source : convert(source, false);
  if (
    digest(local) !== LOCAL ||
    digest(canonical) !== CANONICAL ||
    convert(local, false) !== canonical ||
    convert(canonical, true) !== local
  )
    throw Error("BACKEND197_UNIT_CONFIG_INVERSE");
  return Object.freeze({ local, canonical });
}
export function prepareBackend197UnitFixtures(
  repository,
  scratch,
  prefix,
  roots,
) {
  const paths = new Set([
    "tests/e2e/fixtures/backend-successor-197-source.json",
  ]);
  for (const name of [
    "principal-review-r2-ci-source.json",
    "principal-backend-engine-187-source.json",
    "principal-backend-first-188-source.json",
    "principal-backend-first-191-source.json",
    "backend-http-local-193-source.json",
    "backend-http-195-source.json",
    "backend-successor-197-source.json",
  ]) {
    const path = "tests/e2e/fixtures/" + name;
    paths.add(path);
    const map = JSON.parse(readFileSync(resolve(repository, path), "utf8"));
    for (const row of [
      ...(map.sources ?? []),
      ...(map.additionalRuntimeSources ?? []),
      ...(map.evidenceSources ?? []),
      ...(map.additionalSources ?? []),
    ])
      paths.add(row.path);
  }
  const bytes = new Map(
    [...paths].map((p) => [p, readFileSync(resolve(repository, p))]),
  );
  const configs = backend197UnitConfigPair(
    bytes.get("supabase/config.toml").toString("utf8"),
  );
  let active;
  return {
    prepare() {
      active = realpathSync(mkdtempSync(resolve(scratch, prefix)));
      roots.push(active);
      for (const [path, data] of bytes) {
        mkdirSync(dirname(resolve(active, path)), { recursive: true });
        writeFileSync(resolve(active, path), data);
      }
      writeFileSync(resolve(active, "supabase/config.toml"), configs.canonical);
    },
    root(mode) {
      if (!active || !["canonical", "local"].includes(mode))
        throw Error("BACKEND197_UNIT_FIXTURE_REQUIRED");
      writeFileSync(resolve(active, "supabase/config.toml"), configs[mode]);
      return active;
    },
  };
}
