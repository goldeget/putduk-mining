import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdirSync: vi.fn(actual.mkdirSync) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
import {
  readHistoricalRecoverySource,
  readHistoricalRecoveryFixtureSource,
  verifyHistoricalRecoveryBytes,
  stageHistoricalRecoveryTestSource,
  prepareBackend197UnitFixtures,
} from "../../scripts/historical-recovery-unit-stage.mjs";
import { stageBackend197UnitFixtureSource } from "../../scripts/backend-successor-197-unit-fixture.mjs";
import { tmpdir } from "node:os";
const root = resolve(".");
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const preserved = (path: string) =>
  execFileSync("git", [
    "--no-optional-locks",
    "show",
    `630ca8ac2cfda90e39cdf6e04b0df906986cb275:${path}`,
  ]);

describe("cold historical browser fixture reads", () => {
  it("batches frozen transport blobs instead of spawning Git once per file", async () => {
    vi.resetModules();
    const isolated =
      await import("../../scripts/historical-recovery-unit-stage.mjs");
    const git = vi.mocked(execFileSync);
    git.mockClear();
    expect(
      digest(
        isolated.readHistoricalBrowserTransportSource(
          root,
          "scripts/ci-authenticated-shards.mjs",
        ),
      ),
    ).toBe("c956696b96bc6b5670000917f512ac15dbd503018a85c39aeea5d8e36bc2b24c");
    expect(
      digest(
        isolated.readHistoricalBrowserTransportSource(
          root,
          "scripts/ci-authenticated-shards.d.mts",
        ),
      ),
    ).toBe("e377f11a96a91d45c2cf3b3c62f18902684ec1816f9ae30c3fdaaf71d939695d");
    expect(git.mock.calls).toHaveLength(2);
    expect(git.mock.calls[1]?.[1]).toEqual(["cat-file", "--batch"]);
  });
  it.each([
    ["truncated", "GIT_BATCH_INVALID"],
    ["changed bytes", "BLOB_CHANGED"],
    ["missing blob", "EXACT_BLOB_UNAVAILABLE"],
  ])(
    "rejects %s from an immutable Git batch without a fallback process",
    async (kind, error) => {
      vi.resetModules();
      const isolated =
        await import("../../scripts/historical-recovery-unit-stage.mjs");
      const actual =
        await vi.importActual<typeof import("node:child_process")>(
          "node:child_process",
        );
      const guard = preserved(
        "scripts/backend-successor-197-browser-source.mjs",
      );
      const names = [
        ...guard.toString("utf8").matchAll(/"([^"\n]+)":\s*"([a-f0-9]{64})"/g),
      ].map((match) => match[1]!);
      const key = "630ca8ac2cfda90e39cdf6e04b0df906986cb275:";
      let response = actual.execFileSync("git", ["cat-file", "--batch"], {
        input: names.map((name) => key + name).join("\n") + "\n",
      });
      const headerEnd = response.indexOf(10);
      if (kind === "truncated") response = response.subarray(0, headerEnd);
      else if (kind === "changed bytes")
        response[headerEnd + 1] = response[headerEnd + 1]! ^ 1;
      else {
        const size = Number(
          response.subarray(0, headerEnd).toString("utf8").split(" ")[2],
        );
        response = Buffer.concat([
          Buffer.from(key + names[0] + " missing\n"),
          response.subarray(headerEnd + size + 2),
        ]);
      }
      const git = vi.mocked(execFileSync);
      git.mockClear();
      git.mockReturnValueOnce(guard).mockReturnValueOnce(response);
      expect(() =>
        isolated.readHistoricalBrowserTransportSource(root, names[0]!),
      ).toThrow(error);
      expect(git.mock.calls).toHaveLength(2);
    },
  );
});
describe("historical recovery test-only staging", () => {
  it.each(["valid", "changed", "cleanup"])(
    "awaits exact canonical fixture readiness during setup: %s bytes",
    async (copy) => {
      const original = preserved(
        "tests/unit/backend-http-canonical-source.test.ts",
      ).toString("utf8");
      const staged = stageHistoricalRecoveryTestSource(
        original,
        "backend-http-canonical-source.test.ts",
      );
      const start = staged.indexOf("let preparedCanonicalRoot:");
      const end = staged.indexOf("\nfunction append(", start);
      const originalStart = original.indexOf("function fixture(local = false)");
      const originalEnd = original.indexOf("\nfunction append(", originalStart);
      const cleanupStart = staged.indexOf("afterEach(");
      const cleanupEnd = staged.indexOf("\n// Git bytes", cleanupStart);
      const originalCleanupStart = original.indexOf("afterEach(");
      const originalCleanupEnd = original.indexOf(
        "\n// Git bytes",
        originalCleanupStart,
      );
      expect(
        staged
          .slice(staged.indexOf("\n") + 1)
          .replace(
            staged.slice(start, end),
            original.slice(originalStart, originalEnd),
          )
          .replace(
            staged.slice(cleanupStart, cleanupEnd),
            original.slice(originalCleanupStart, originalCleanupEnd),
          )
          .replace("afterEach, beforeEach, describe", "afterEach, describe"),
      ).toBe(original);
      const scratch = realpathSync(tmpdir());
      const prefix = "putduk-backend-canonical-source-";
      const roots: string[] = [];
      let setup: () => unknown = () => undefined;
      let cleanup: () => unknown = () => undefined;
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      let inspected = 0;
      let verified = false,
        deletes = 0;
      const isolated =
        await import("../../scripts/historical-recovery-unit-stage.mjs");
      const fixture = runInNewContext(
        stripTypeScriptTypes(
          staged.slice(cleanupStart, cleanupEnd) +
            "\n" +
            staged.slice(start, end) +
            "\nfixture;",
        ),
        {
          beforeEach: (callback: () => unknown) => {
            setup = callback;
          },
          afterEach: (callback: () => unknown) => {
            cleanup = callback;
          },
          createHistoricalFixturePreparation:
            isolated.createHistoricalFixturePreparation,
          ownedRoots: roots,
          tempParent: scratch,
          realpathSync,
          relative,
          isAbsolute,
          rmSync: (path: string) => {
            deletes++;
            if (!verified) throw Error("READS_ACTIVE_DURING_DELETE");
            rmSync(path, { recursive: true, force: true });
          },
          checkout: root,
          baselinePath: "baseline.json",
          layers: [],
          predecessors: [],
          manifestPath: "manifest.json",
          profilePath: "profile.json",
          tempPrefix: prefix,
          join,
          dirname,
          mkdirSync,
          writeFileSync,
          readFileSync: () =>
            JSON.stringify({
              sources: [
                { path: "runtime.ts" },
                { path: "supabase/config.toml" },
              ],
            }),
          frozenConfig: () => Buffer.from("canonical config"),
          localTestConfig: () => Buffer.from("local config"),
          newOwnedRoot: () => {
            const fixtureRoot = mkdtempSync(join(scratch, prefix));
            roots.push(fixtureRoot);
            return fixtureRoot;
          },
          primeHistoricalRecoveryFixtureSources: () => undefined,
          readHistoricalRecoveryFixtureSource: (_: string, path: string) =>
            Buffer.from("frozen " + path),
          verifyPreparedHistoricalFixtureConcurrently: async (
            ...args: Parameters<
              typeof isolated.verifyPreparedHistoricalFixtureConcurrently
            >
          ) => {
            inspected++;
            await gate;
            if (copy === "changed")
              writeFileSync(join(roots[0]!, "runtime.ts"), "changed");
            try {
              return await isolated.verifyPreparedHistoricalFixtureConcurrently(
                ...args,
              );
            } finally {
              verified = true;
            }
          },
        },
      ) as () => string;
      let pending: unknown;
      const owned: string[] = [];
      try {
        pending = setup();
        owned.push(...roots);
        expect(pending).toHaveProperty("then", expect.any(Function));
        expect(inspected).toBe(1);
        expect(() => fixture()).toThrow("FIXTURE_REQUIRED");
        if (copy === "cleanup") {
          const cleaning = Promise.resolve(cleanup());
          expect(deletes).toBe(0);
          expect(() => fixture()).toThrow("FIXTURE_REQUIRED");
          release();
          await Promise.all([pending, cleaning]);
          expect(deletes).toBe(owned.length);
          expect(() => fixture()).toThrow("FIXTURE_REQUIRED");
        } else if (copy === "changed") {
          release();
          await expect(pending).rejects.toThrow("FIXTURE_COPY_CHANGED");
          expect(() => fixture()).toThrow("FIXTURE_REQUIRED");
        } else {
          release();
          await pending;
          expect(fixture()).toBe(roots[0]);
          expect(readFileSync(join(roots[0]!, "runtime.ts"), "utf8")).toBe(
            "frozen runtime.ts",
          );
          expect(() => fixture()).toThrow("FIXTURE_REQUIRED");
        }
      } finally {
        release();
        await Promise.resolve(pending).catch(() => undefined);
        for (const fixtureRoot of owned) {
          const target = resolve(fixtureRoot);
          if (
            dirname(target) !== scratch ||
            !basename(target).startsWith(prefix)
          )
            throw Error("FIXTURE_CLEANUP_SCOPE");
          rmSync(target, { recursive: true, force: true });
        }
      }
    },
  );
  it("rejects a fixture scratch/prefix outside the frozen test scope before writing", () => {
    expect(() =>
      prepareBackend197UnitFixtures(root, root, "putduk-backend197-unit-", []),
    ).toThrow("FIXTURE_SCOPE_REJECTED");
    expect(() =>
      prepareBackend197UnitFixtures(root, tmpdir(), "../outside", []),
    ).toThrow("FIXTURE_SCOPE_REJECTED");
  });
  it("loads exact historical globals while keeping current UI bytes separate", () => {
    const historical = readHistoricalRecoverySource(
      root,
      "app/globals.css",
      197,
    );
    expect(digest(historical)).toBe(
      "b043c74c8b2690923b25efb995d59b2e4cc16d7f3eeaad164c299951832f47ab",
    );
    expect(digest(readFileSync("app/globals.css"))).not.toBe(
      digest(historical),
    );
  });
  it("rejects a wrong blob, a recomputed caller digest and current modified UI bytes", () => {
    const wrong = Buffer.from("caller-provided replacement");
    expect(digest(wrong)).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      verifyHistoricalRecoveryBytes("app/globals.css", wrong, 197),
    ).toThrow("BLOB_CHANGED");
    expect(() =>
      verifyHistoricalRecoveryBytes(
        "app/globals.css",
        readFileSync("app/globals.css"),
        197,
      ),
    ).toThrow("BLOB_CHANGED");
    expect(() =>
      verifyHistoricalRecoveryBytes(
        "app/globals.css",
        preserved("lib/ai/usage.ts"),
        197,
      ),
    ).toThrow("BLOB_CHANGED");
  });
  it.each([
    "../outside",
    "C:/outside",
    "app\\globals.css",
    "/outside",
    "app/../outside",
  ])("rejects path escape %s", (path) => {
    expect(() => readHistoricalRecoverySource(root, path, 197)).toThrow(
      "PATH_REJECTED",
    );
  });
  it("rejects arbitrary roots and unmapped product paths", () => {
    expect(() =>
      readHistoricalRecoverySource(resolve(".."), "app/globals.css", 197),
    ).toThrow("ROOT_REJECTED");
    expect(() =>
      readHistoricalRecoverySource(root, "package.json", 191),
    ).toThrow("UNMAPPED_SOURCE");
  });
  it.each([
    "principal-review-r2-source.test.ts",
    "principal-e2e-source.test.ts",
    "backend-http-canonical-source.test.ts",
    "backend-http-local-source.test.ts",
    "backend-http-195-source.test.ts",
    "backend-successor-197-source.test.ts",
  ])("stages only exact original %s and rejects extra bytes", (name) => {
    const original = preserved("tests/unit/" + name).toString("utf8");
    const input =
      name === "backend-successor-197-source.test.ts"
        ? stageBackend197UnitFixtureSource(original)
        : original;
    expect(stageHistoricalRecoveryTestSource(input, name)).toContain(
      "historical-recovery-unit-stage.mjs",
    );
    expect(() =>
      stageHistoricalRecoveryTestSource(input + "\n// changed", name),
    ).toThrow("TEST_SOURCE_CHANGED");
  });
});

describe("principal-v4 current UI separation", () => {
  it.each([
    [
      "app/(product)/wallet/withdraw/page.tsx",
      "feadc26536a19f5173b9fad961fcb93002783fa62fc11c14af92c83251eb3215",
    ],
    [
      "components/product/principal-crypto-withdrawal-form.tsx",
      "b71e00a8c2f156c99804b0d68064c535dfc0ca82286bd6d8e208f9486785dab1",
    ],
    [
      "components/product/principal-withdrawal-form.tsx",
      "6be8818f2afb11fac9e751e4c4f244634c5061f831cda1f5f3994621ab5ef5df",
    ],
  ])(
    "copies only the exact original %s and rejects its current UI bytes",
    (path, expected) => {
      const original = readHistoricalRecoveryFixtureSource(root, path, 191);
      expect(digest(original)).toBe(expected);
      expect(original.equals(preserved(path))).toBe(true);
      expect(digest(readFileSync(path))).not.toBe(expected);
      expect(verifyHistoricalRecoveryBytes(path, original, 191)).toBe(true);
      expect(() =>
        verifyHistoricalRecoveryBytes(path, readFileSync(path), 191),
      ).toThrow("BLOB_CHANGED");
      expect(() =>
        verifyHistoricalRecoveryBytes(
          path,
          Buffer.from("caller rewritten source"),
          191,
        ),
      ).toThrow("BLOB_CHANGED");
    },
  );
  it("keeps all190 v4 pins and the complete original principal test assertions and timeouts", () => {
    const bytes = readFileSync(
      "tests/e2e/fixtures/principal-local-recovery-source-v4.json",
    );
    expect(digest(bytes)).toBe(
      "6d4af5c25f3a4fe45f3c60a860838c9f1d2857fa36cd51e1b287e6e5e09e53ce",
    );
    const map = JSON.parse(bytes.toString("utf8")) as {
      sources: { path: string; sha256: string }[];
    };
    expect(map.sources).toHaveLength(190);
    for (const row of map.sources) {
      const historical = readHistoricalRecoveryFixtureSource(
        root,
        row.path,
        191,
      );
      expect(digest(historical)).toBe(row.sha256);
    }
    const original = preserved(
      "tests/unit/principal-e2e-source.test.ts",
    ).toString("utf8");
    const staged = stageHistoricalRecoveryTestSource(
      original,
      "principal-e2e-source.test.ts",
    );
    const imported =
      'import { readHistoricalRecoveryFixtureSource } from "../../scripts/historical-recovery-unit-stage.mjs";\n';
    expect(
      staged
        .slice(imported.length)
        .replace(
          'writeFileSync(target, readHistoricalRecoveryFixtureSource(resolve("."), path, 191));',
          "writeFileSync(target, readFileSync(path));",
        ),
    ).toBe(original);
    expect(() =>
      stageHistoricalRecoveryTestSource(
        original.replace("runtimeSources: 15", "runtimeSources: 14"),
        "principal-e2e-source.test.ts",
      ),
    ).toThrow("TEST_SOURCE_CHANGED");
  });
});

// Full fixture construction and the valid/corrupt readiness subject execute in
// bounded setup. Bodies assert contracts; these are not five-second I/O benchmarks.
type HistoricalModule =
  typeof import("../../scripts/historical-recovery-unit-stage.mjs");
type PreparedFixture =
  | ReturnType<HistoricalModule["prepareHistorical195UnitFixtures"]>
  | ReturnType<HistoricalModule["prepareBackend197UnitFixtures"]>;
describe.each([195, 197])(
  "full historical %i preparation in bounded setup",
  (generation) => {
    describe.each(["valid", "changed", "cleanup"])("%s copy", (copy) => {
      const scratch = realpathSync(tmpdir());
      const prefix =
        generation === 195
          ? "putduk-backend-195-source-"
          : "putduk-backend197-unit-";
      let h: {
        roots: string[];
        owned: string[];
        prepared?: PreparedFixture;
        returned?: unknown;
        pending?: Promise<unknown>;
        cleaning?: Promise<unknown>;
        error?: unknown;
        release?: () => void;
        restore?: () => void;
        cleanup?: () => unknown;
        active: number;
        peak: number;
        deletes: number;
        requests: number;
        physicalReads: number;
        snapshots: Map<string, Buffer>;
        mkdirCalls: unknown[];
      };
      beforeEach(
        async () => {
          h = {
            roots: [],
            owned: [],
            active: 0,
            peak: 0,
            deletes: 0,
            requests: 0,
            physicalReads: 0,
            snapshots: new Map(),
            mkdirCalls: [],
          };
          const isolated =
            await import("../../scripts/historical-recovery-unit-stage.mjs");
          const actual =
            await vi.importActual<typeof import("node:fs/promises")>(
              "node:fs/promises",
            );
          const prepared =
            generation === 195
              ? isolated.prepareHistorical195UnitFixtures(
                  root,
                  scratch,
                  prefix,
                  h.roots,
                )
              : isolated.prepareBackend197UnitFixtures(
                  root,
                  scratch,
                  prefix,
                  h.roots,
                );
          h.prepared = prepared;
          let release!: () => void;
          const gate = new Promise<void>((done) => {
            release = done;
          });
          h.release = release;
          h.restore = () => {
            vi.mocked(readFileAsync).mockImplementation(actual.readFile);
          };
          vi.mocked(readFileAsync).mockImplementation(async (file) => {
            const request = ++h.requests;
            h.active++;
            h.peak = Math.max(h.peak, h.active);
            try {
              await gate;
              // Lifecycle cases keep actual helper/lifecycle/cleanup wiring. Full
              // physical reads belong to valid/corrupt cases; eight real async reads
              // suffice to control pending I/O here. Other responses are exact copied
              // bytes independently read during bounded setup, never production cache.
              if (copy === "cleanup" && request > 8) {
                const bytes = h.snapshots.get(resolve(String(file)));
                if (!bytes) throw Error("MISSING_LIFECYCLE_TEST_COPY_BYTES");
                return Buffer.from(bytes);
              }
              h.physicalReads++;
              return await actual.readFile(file);
            } finally {
              h.active--;
            }
          });
          if (copy === "changed")
            vi.mocked(readFileAsync).mockImplementationOnce(async () =>
              Buffer.from("changed copied bytes"),
            );
          vi.mocked(mkdirSync).mockClear();
          h.returned =
            generation === 195
              ? (
                  prepared as ReturnType<
                    HistoricalModule["prepareHistorical195UnitFixtures"]
                  >
                ).prepare("fixture readiness regression")
              : (
                  prepared as ReturnType<
                    HistoricalModule["prepareBackend197UnitFixtures"]
                  >
                ).prepare();
          h.owned.push(...h.roots);
          h.pending = Promise.resolve(h.returned);
          void h.pending.catch(() => undefined);
          if (copy === "cleanup") {
            const snapshot = (directory: string) => {
              for (const entry of readdirSync(directory, {
                withFileTypes: true,
              })) {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) snapshot(path);
                else h.snapshots.set(resolve(path), readFileSync(path));
              }
            };
            for (const fixture of h.owned) snapshot(fixture);
            const name =
              generation === 195
                ? "backend-http-195-source.test.ts"
                : "backend-successor-197-source.test.ts";
            const original = preserved("tests/unit/" + name).toString("utf8");
            const frozen =
              generation === 197
                ? stageBackend197UnitFixtureSource(original)
                : original;
            const staged = isolated.stageHistoricalRecoveryTestSource(
              frozen,
              name,
            );
            const start = staged.indexOf("afterEach("),
              end = staged.indexOf("\ndescribe(", start);
            if (generation === 197) {
              const originalStart = frozen.indexOf("afterEach("),
                originalEnd = frozen.indexOf("\ndescribe(", originalStart);
              expect(
                staged
                  .replace(
                    staged.slice(start, end),
                    frozen.slice(originalStart, originalEnd),
                  )
                  .replace(
                    '"../../scripts/historical-recovery-unit-stage.mjs"',
                    '"../../scripts/backend-successor-197-unit-fixture.mjs"',
                  )
                  .replace(
                    'beforeEach(() => stagedFixture.prepare(), process.platform === "win32" ? 30_000 : 10_000);',
                    "beforeEach(() => stagedFixture.prepare());",
                  ),
              ).toBe(frozen);
            }
            runInNewContext(stripTypeScriptTypes(staged.slice(start, end)), {
              afterEach: (callback: () => unknown) => {
                h.cleanup = callback;
              },
              historical195: prepared,
              stagedFixture: prepared,
              roots: h.roots,
              scratch,
              PREFIX: prefix,
              dirname,
              basename,
              rmSync: (path: string) => {
                h.deletes++;
                if (h.active) throw Error("READS_ACTIVE_DURING_DELETE");
                rmSync(path, { recursive: true, force: true });
              },
            });
          } else {
            release();
            await h.pending.catch((error) => {
              h.error = error;
            });
          }
          h.mkdirCalls = vi.mocked(mkdirSync).mock.calls.map(([path]) => path);
        },
        process.platform === "win32" ? 30_000 : 10_000,
      );
      afterEach(async () => {
        if (!h) return;
        h.release?.();
        await Promise.allSettled([h.pending, h.cleaning]);
        if (h.prepared && "settle" in h.prepared) await h.prepared.settle();
        h.restore?.();
        for (const fixture of new Set([...h.owned, ...h.roots])) {
          if (
            dirname(fixture) !== scratch ||
            !basename(fixture).startsWith(prefix)
          )
            throw Error("FIXTURE_CLEANUP_SCOPE");
          rmSync(fixture, { recursive: true, force: true });
        }
      });
      it("retains exact inventory, bounded reads and timeout-safe actual helper wiring", async () => {
        const prepared = h.prepared!;
        expect(h.returned).toHaveProperty("then", expect.any(Function));
        if (copy === "cleanup") {
          expect(h.active).toBeGreaterThan(0);
          expect(() => prepared.root("canonical")).toThrow("FIXTURE_REQUIRED");
          h.cleaning = Promise.resolve(h.cleanup!());
          expect(h.deletes).toBe(0);
          h.release!();
          await Promise.all([h.pending, h.cleaning]);
          expect(h.requests).toBe(h.snapshots.size);
          expect(h.physicalReads).toBe(8);
          expect(h.deletes).toBe(h.owned.length);
          expect(() => prepared.root("canonical")).toThrow("FIXTURE_REQUIRED");
        } else if (copy === "changed") {
          expect(h.error).toHaveProperty(
            "message",
            expect.stringContaining("FIXTURE_COPY_CHANGED"),
          );
          expect(() => prepared.root("canonical")).toThrow("FIXTURE_REQUIRED");
        } else {
          expect(h.error).toBeUndefined();
          expect(h.mkdirCalls).toHaveLength(new Set(h.mkdirCalls).size);
          const fixture = prepared.root("canonical");
          expect(
            digest(readFileSync(join(fixture, "supabase/config.toml"))),
          ).toBe(
            "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac",
          );
          expect(
            readdirSync(join(fixture, "supabase/migrations")).filter((name) =>
              name.endsWith(".sql"),
            ),
          ).toHaveLength(generation);
          if (generation === 197) {
            expect(prepared.root("local")).toBe(fixture);
            expect(
              digest(readFileSync(join(fixture, "supabase/config.toml"))),
            ).toBe(
              "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7",
            );
          }
        }
        expect(h.active).toBe(0);
        expect(h.peak).toBeGreaterThan(1);
        expect(h.peak).toBeLessThanOrEqual(4);
      });
    });
  },
);

describe("explicit historical fixture setup budgets", () => {
  it.each([
    ["backend-http-195-source.test.ts", "win32", 30_000],
    ["backend-http-195-source.test.ts", "linux", 10_000],
    ["backend-successor-197-source.test.ts", "win32", 30_000],
    ["backend-successor-197-source.test.ts", "linux", 10_000],
  ] as const)(
    "sets %s on %s to %i without changing body timeout",
    (name, platform, expected) => {
      const original = preserved("tests/unit/" + name).toString("utf8");
      const frozen =
        name === "backend-successor-197-source.test.ts"
          ? stageBackend197UnitFixtureSource(original)
          : original;
      const staged = stageHistoricalRecoveryTestSource(frozen, name);
      const start = staged.indexOf(
        name === "backend-http-195-source.test.ts"
          ? "const historical195 ="
          : "const stagedFixture =",
      );
      const end = staged.indexOf("\nfunction fixture(", start);
      let timeout: unknown;
      runInNewContext(stripTypeScriptTypes(staged.slice(start, end)), {
        prepareHistorical195UnitFixtures: () => ({ prepare() {} }),
        prepareBackend197UnitFixtures: () => ({ prepare() {} }),
        ROOT: root,
        scratch: tmpdir(),
        PREFIX: "",
        roots: [],
        process: { platform },
        beforeEach: (_: unknown, value: unknown) => {
          timeout = value;
        },
      });
      expect(timeout).toBe(expected);
      const originalBody = frozen.slice(frozen.indexOf("\ndescribe("));
      expect(staged.slice(staged.indexOf("\ndescribe("))).toBe(originalBody);
      expect(staged).not.toContain("testTimeout");
    },
  );
});
