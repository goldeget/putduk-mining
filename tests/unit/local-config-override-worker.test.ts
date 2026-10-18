import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocked.spawn }));
import { requireLocalWorkerTestEnv } from "../../workers/local-test-target.mjs";
import {
  readSupabaseStatus,
  resolveJobLocalConfig,
} from "../../scripts/capture-local-supabase-env.mjs";
afterEach(() => {
  vi.unstubAllEnvs();
  mocked.spawn.mockReset();
});
describe("worker and status config selection", () => {
  function fixture(run: (env: Record<string, string>, task: string) => void) {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const task = createOwnedTask(root, "worker-config-");
    mkdirSync(join(task, "supabase"));
    const path = join(task, "supabase/config.toml");
    writeFileSync(
      path,
      'project_id = "putduk-mining-worker-unit"\n[api]\nport = 65131\n[db]\nport = 65132\n',
    );
    const env = {
      APP_ENV: "test",
      PUTDUK_LOCAL_SUPABASE_CONFIG_PATH: path,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:65131",
      SUPABASE_SECRET_KEY: "sb_secret_inert_worker_unit",
      LOCAL_SUPABASE_PROJECT_ID: "putduk-mining-worker-unit",
    };
    try {
      run(env, task);
    } finally {
      removeOwnedTask(task, root);
    }
  }
  it("admits exact supplied environment before any service-client construction", () => {
    fixture((env) => {
      expect(requireLocalWorkerTestEnv(env)).toEqual({
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        secret: env.SUPABASE_SECRET_KEY,
        container: "supabase_db_putduk-mining-worker-unit",
      });
      for (const extra of [
        { APP_ENV: "production" },
        { APP_ENV: "staging" },
        { LOCAL_SUPABASE_PROJECT_ID: "putduk-mining-other" },
        { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:63421" },
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
        },
      ])
        expect(() => requireLocalWorkerTestEnv({ ...env, ...extra })).toThrow();
      expect(mocked.spawn).not.toHaveBeenCalled();
    });
  });
  it("reads status only from the validated workdir and rejects invalid path before spawn", () => {
    fixture((env, task) => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      mocked.spawn.mockReturnValue({
        status: 0,
        stdout:
          "API_URL=http://127.0.0.1:65131\nPUBLISHABLE_KEY=sb_publishable_inert_unit\nSECRET_KEY=sb_secret_inert_worker_unit\nDB_URL=postgresql://postgres:dummy@127.0.0.1:65132/postgres\n",
        stderr: "",
      });
      expect(readSupabaseStatus().apiUrl).toBe(env.NEXT_PUBLIC_SUPABASE_URL);
      expect(mocked.spawn).toHaveBeenCalledWith(
        "supabase",
        ["status", "--workdir", resolve(task), "-o", "env"],
        expect.objectContaining({
          cwd: expect.any(String),
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      mocked.spawn.mockClear();
      vi.stubEnv(
        "PUTDUK_LOCAL_SUPABASE_CONFIG_PATH",
        join(task, "wrong/config.toml"),
      );
      expect(() => readSupabaseStatus()).toThrow();
      expect(mocked.spawn).not.toHaveBeenCalled();
      vi.stubEnv("PUTDUK_LOCAL_SUPABASE_CONFIG_PATH", undefined);
      const root = fileURLToPath(new URL("../..", import.meta.url));
      expect(resolve(resolveJobLocalConfig().configPath)).toBe(
        resolve(root, "supabase/config.toml"),
      );
    });
  });
});

function createOwnedTask(root: string, prefix: string) {
  const task = join(root, `.next-qa-${prefix}${randomUUID()}`);
  mkdirSync(task); // Exclusive creation; never overwrite a pre-existing path.
  return task;
}
function removeOwnedTask(task: string, root: string) {
  const at = realpathSync(task);
  const rel = relative(realpathSync(root), at);
  if (
    isAbsolute(rel) ||
    !/^\.next-qa-[a-z0-9-]{1,64}$/.test(rel) ||
    at !== resolve(task)
  )
    throw new Error("UNIT_TEMP_DELETE_SCOPE_REJECTED");
  rmSync(at, { recursive: true });
}
