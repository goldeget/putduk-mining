import type { SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  processJobBatch,
  processOutboxBatch,
  runDurableLoop,
  stopAllLeaseRenewals,
} from "../../workers/runner.mjs";
import { requireLocalWorkerTestEnv } from "../../workers/local-test-target.mjs";
import { loadJobLocalAllowlist } from "../../scripts/capture-local-supabase-env.mjs";

afterEach(() => {
  stopAllLeaseRenewals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bounded worker ownership", () => {
  it.each(["outbox", "job"] as const)(
    "keeps the next %s unclaimed while a long handler renews its own lease",
    async (lane) => {
      vi.useFakeTimers();
      const rows = ["first", "second"].map((id) => ({
        id,
        event_type: "OWNERSHIP_PROBE.v1",
        job_type: "OWNERSHIP_PROBE",
        attempt_count: 0,
        attempts: 0,
        state: "PENDING",
        expires: 0,
      }));
      const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name.startsWith("claim_")) {
          const claimed = rows
            .filter((row) => row.state === "PENDING")
            .slice(0, Number(args.p_batch_size));
          for (const row of claimed) {
            row.state = "OWNED";
            row.expires = Date.now() + Number(args.p_lease_seconds) * 1_000;
            row.attempts += 1;
            row.attempt_count += 1;
          }
          return { data: claimed, error: null };
        }
        const row = rows.find(
          (candidate) => candidate.id === (args.p_job_id ?? args.p_event_id),
        )!;
        if (row.expires < Date.now()) {
          return { error: { message: "LEASE_NOT_OWNED" } };
        }
        if (name.startsWith("extend_")) {
          row.expires = Date.now() + Number(args.p_lease_seconds) * 1_000;
        } else if (name.startsWith("complete_")) {
          row.state = "COMPLETED";
        }
        return { error: null };
      });
      const handler = async (_client: SupabaseClient, row: { id: string }) => {
        if (row.id === "first") {
          await new Promise((resolve) => setTimeout(resolve, 11_000));
          expect(rows[1]?.state).toBe("PENDING");
          expect(rows[1]?.attempts).toBe(0);
        }
      };
      const options = {
        batchSize: 2,
        leaseSeconds: 10,
        leaseRenewIntervalMs: 1_000,
        outboxHandlers: { "OWNERSHIP_PROBE.v1": handler },
        jobHandlers: { OWNERSHIP_PROBE: handler },
      };
      const client = { rpc } as unknown as SupabaseClient;
      const pending =
        lane === "outbox"
          ? processOutboxBatch(client, options)
          : processJobBatch(client, options);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(await pending).toEqual({
        claimed: 2,
        completed: 2,
        failed: 0,
        unsupported: 0,
      });
      expect(rows.map((row) => row.attempts)).toEqual([1, 1]);
      expect(
        rpc.mock.calls.filter(([name]) => name.startsWith("claim_")),
      ).toHaveLength(2);
    },
  );

  it("returns a failed zero-delay item to polling without draining its attempt budget", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "claim_outbox_events"
        ? {
            data: [{ id: "first", event_type: "RETRY.v1", attempt_count: 1 }],
            error: null,
          }
        : { error: null },
    );
    const summary = await processOutboxBatch(
      { rpc } as unknown as SupabaseClient,
      {
        batchSize: 25,
        retryDelaySeconds: 0,
        outboxHandlers: {
          "RETRY.v1": () => {
            throw new Error("TRANSIENT");
          },
        },
      },
    );
    expect(summary.failed).toBe(1);
    expect(
      rpc.mock.calls.filter(([name]) => name === "claim_outbox_events"),
    ).toHaveLength(1);
  });

  it("counts a failed failure receipt as failed work", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_system_jobs")
        return {
          data: [{ id: "first", job_type: "FAIL", attempts: 1 }],
          error: null,
        };
      if (name === "fail_system_job")
        return { error: { message: "DB_UNAVAILABLE" } };
      return { error: null };
    });
    const summary = await processJobBatch(
      { rpc } as unknown as SupabaseClient,
      {
        batchSize: 1,
        jobHandlers: {
          FAIL: () => {
            throw new Error("TRANSIENT");
          },
        },
      },
    );
    expect(summary.failed).toBe(1);
    expect(summary.completed).toBe(0);
  });

  it("rejects a bounded invocation when claim RPCs fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const client = {
      rpc: async () => ({ error: { message: "DB_UNAVAILABLE" } }),
    };
    await expect(
      runDurableLoop({
        client: client as unknown as SupabaseClient,
        once: true,
      }),
    ).rejects.toThrow("WORKER_ONCE_FAILED");
  });

  it("returns a nonzero CLI status when both claim requests fail", () => {
    // Replace fetch before importing the runner; this process has no network
    // or injected production credentials, and exercises the real CLI exit.
    const interceptor = `globalThis.fetch = async () => new Response(
      JSON.stringify({ message: "UNIT_DB_UNAVAILABLE" }),
      { status: 503, headers: { "content-type": "application/json" } });`;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript;base64,${Buffer.from(interceptor).toString("base64")}`,
        "workers/runner.mjs",
        "--once",
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
          SUPABASE_SECRET_KEY: "worker-unit-fixture",
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("worker.once.summary");
    expect(result.stderr).toContain("WORKER_ONCE_FAILED");
  });
});

describe("worker integration target boundary", () => {
  const target = loadJobLocalAllowlist();
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${target.apiPort}`,
    SUPABASE_SECRET_KEY: "worker-unit-fixture",
    LOCAL_SUPABASE_PROJECT_ID: target.projectId,
  };

  it("accepts only the configured local API and container", () => {
    expect(requireLocalWorkerTestEnv(env)).toEqual({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      secret: env.SUPABASE_SECRET_KEY,
      container: `supabase_db_${target.projectId}`,
    });
  });

  it.each([
    { NEXT_PUBLIC_SUPABASE_URL: "http://example.com:58421" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58422" },
    { NEXT_PUBLIC_SUPABASE_URL: `${env.NEXT_PUBLIC_SUPABASE_URL}/another` },
    { LOCAL_SUPABASE_PROJECT_ID: `${target.projectId}-other` },
    { APP_ENV: "production" },
    { APP_ENV: "staging" },
  ])(
    "rejects a mismatched target before client or fixture creation: %j",
    (override) => {
      expect(() =>
        requireLocalWorkerTestEnv({ ...env, ...override }),
      ).toThrow();
    },
  );
});
