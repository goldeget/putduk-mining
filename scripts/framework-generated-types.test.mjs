import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { writeAppTypeDeclarations } = await import(
  pathToFileURL(
    require.resolve("next/dist/lib/typescript/writeAppTypeDeclarations.js"),
  ).href
);
const { generateRouteTypes } = await import(
  new URL("./typegen.js", import.meta.resolve("vinext")).href
);
const readJson = (name) => JSON.parse(readFileSync(name, "utf8"));
const packageFor = (relative = "") =>
  readJson(path.join(source, relative, "package.json"));

function fixture(t) {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(path.join(parent, "putduk-generated-types-"));
  t.after(() => {
    const actual = realpathSync(directory);
    assert.equal(actual, directory);
    assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith("putduk-generated-types-"));
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    rmSync(actual, { recursive: true });
  });
  copyFileSync(
    path.join(source, ".gitignore"),
    path.join(directory, ".gitignore"),
  );
  const gitEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)),
  );
  gitEnv.GIT_CONFIG_NOSYSTEM = "1";
  gitEnv.GIT_CONFIG_GLOBAL = path.join(directory, ".unused-global-config");
  const git = (...args) => {
    try {
      return execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
        cwd: directory,
        env: gitEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      if (args[0] === "check-ignore" && error.status === 1) return "";
      throw error;
    }
  };
  git("init", "--quiet");
  return { directory, git };
}

test("both application typechecks generate framework declarations before checking", () => {
  assert.equal(
    packageFor().scripts["typecheck:web"],
    "next typegen && tsc --noEmit",
  );
  assert.equal(
    packageFor("apps/admin").scripts.typecheck,
    "next typegen && tsc --noEmit",
  );
  assert.equal(
    packageFor().scripts["typecheck:admin"],
    "pnpm --dir apps/admin typecheck",
  );
});

test("generated declaration ignores apply only to the two exact app paths", (t) => {
  const { git } = fixture(t);
  const paths = [
    "next-env.d.ts",
    "apps/admin/next-env.d.ts",
    "apps/other/next-env.d.ts",
    "nested/next-env.d.ts",
    "apps/admin/nested/next-env.d.ts",
    "tsconfig.json",
    "apps/admin/tsconfig.json",
    "app/page.tsx",
  ];
  const ignored = git("check-ignore", "--no-index", "--", ...paths)
    .split(/\r?\n/)
    .filter(Boolean);
  assert.deepEqual(ignored, paths.slice(0, 2));
});

test("pinned real Next and Vinext writers can alternate without dirtying tracked source", async (t) => {
  const { directory, git } = fixture(t);
  const nextPackagePath = require.resolve("next/package.json");
  assert.equal(
    readJson(nextPackagePath).version,
    packageFor().dependencies.next,
  );
  assert.equal(
    readJson(new URL("../package.json", import.meta.resolve("vinext"))).version,
    packageFor().dependencies.vinext,
  );
  const apps = [];
  for (const relative of ["", "apps/admin"]) {
    const root = path.join(directory, relative);
    mkdirSync(path.join(root, "app"), { recursive: true });
    for (const name of ["package.json", "tsconfig.json"])
      copyFileSync(path.join(source, relative, name), path.join(root, name));
    // Only package resolution is needed by Vinext's hasNextPackage probe.
    // The generator implementation itself is the actual installed pinned module.
    mkdirSync(path.join(root, "node_modules/next"), { recursive: true });
    copyFileSync(
      nextPackagePath,
      path.join(root, "node_modules/next/package.json"),
    );
    writeFileSync(
      path.join(root, "app/page.tsx"),
      "export default function Page(){return null;}\n",
    );
    writeFileSync(
      path.join(root, "app/layout.tsx"),
      "export default function Layout({children}){return <html><body>{children}</body></html>;}\n",
    );
    const options = {
      baseDir: root,
      distDir: ".next",
      imageImportsEnabled: true,
      hasPagesDir: false,
      hasAppDir: true,
      strictRouteTypes: false,
      typedRoutes: false,
    };
    await writeAppTypeDeclarations(options);
    apps.push({
      root,
      options,
      originalTypes: readFileSync(path.join(root, "next-env.d.ts"), "utf8"),
      tsconfig: readFileSync(path.join(root, "tsconfig.json"), "utf8"),
    });
  }
  // Commit only this disposable repository with a fixed synthetic identity.
  // No user configuration, remote or source checkout index is touched.
  git("add", "--all");
  git(
    "-c",
    "user.name=PUTDUK Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    `core.hooksPath=${path.join(directory, ".no-hooks")}`,
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const baseline = git("status", "--porcelain", "--untracked-files=no");
  assert.equal(baseline, "");
  for (const app of apps) {
    const options = {
      root: app.root,
      appDir: path.join(app.root, "app"),
      pageExtensions: ["tsx", "ts", "jsx", "js"],
    };
    assert.equal((await generateRouteTypes(options)).nextEnvStatus, "updated");
    assert.notEqual(
      readFileSync(path.join(app.root, "next-env.d.ts"), "utf8"),
      app.originalTypes,
    );
    assert.equal(
      (await generateRouteTypes(options)).nextEnvStatus,
      "unchanged",
    );
    assert.equal(
      readFileSync(path.join(app.root, "tsconfig.json"), "utf8"),
      app.tsconfig,
    );
  }
  assert.equal(git("diff", "HEAD", "--name-only"), "");
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), baseline);
  assert.equal(
    git("ls-files", "--", "next-env.d.ts", "apps/admin/next-env.d.ts"),
    "",
  );
  for (const app of apps) {
    await writeAppTypeDeclarations(app.options);
    assert.equal(
      readFileSync(path.join(app.root, "next-env.d.ts"), "utf8"),
      app.originalTypes,
    );
    assert.equal(
      readFileSync(path.join(app.root, "tsconfig.json"), "utf8"),
      app.tsconfig,
    );
  }
  assert.equal(git("diff", "HEAD", "--name-only"), "");
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), baseline);
  writeFileSync(
    path.join(directory, "app/page.tsx"),
    "export default function Page(){return 'changed';}\n",
  );
  assert.equal(git("diff", "HEAD", "--name-only"), "app/page.tsx");
  assert.notEqual(
    git("status", "--porcelain", "--untracked-files=no"),
    baseline,
  );
});
