/**
 * PUTDUK MINING background worker entrypoint.
 *
 * Runs against local/service-role Postgres commands only.
 * Browser is not the runner. Cloudflare Queues are not used.
 */

import { createClient } from "@supabase/supabase-js";

const WORKER_ID =
  process.env.PUTDUK_WORKER_ID?.trim() || `putduk-worker-${process.pid}`;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 3_000;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the worker.`);
  }
  return value;
}

function createServiceClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

function backoffSeconds(attempt) {
  const base = Math.min(3600, 2 ** Math.max(0, attempt - 1));
  return Math.max(5, base);
}

async function heartbeat(startedAt) {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  console.info(
    JSON.stringify({
      type: "worker.heartbeat",
      workerId: WORKER_ID,
      uptimeSec,
      at: new Date().toISOString(),
    }),
  );
}

async function processOutbox(client) {
  const { data, error } = await client.rpc("claim_outbox_events", {
    p_worker_id: WORKER_ID,
    p_batch_size: 25,
    p_lease_seconds: 60,
  });
  if (error) {
    console.error("claim_outbox_events failed", error.message);
    return;
  }

  for (const event of data ?? []) {
    try {
      // Delivery adapters remain domain-owned; worker only leases/completes.
      const { error: completeError } = await client.rpc(
        "complete_outbox_event",
        {
          p_event_id: event.id,
          p_worker_id: WORKER_ID,
        },
      );
      if (completeError) {
        throw new Error(completeError.message);
      }
    } catch (cause) {
      const code =
        cause instanceof Error
          ? cause.message.slice(0, 80)
          : "OUTBOX_HANDLER_FAILED";
      await client.rpc("fail_outbox_event", {
        p_event_id: event.id,
        p_worker_id: WORKER_ID,
        p_error_code: code,
        p_retry_delay_seconds: backoffSeconds(event.attempt_count + 1),
      });
    }
  }
}

async function processJobs(client) {
  const { data, error } = await client.rpc("claim_system_jobs", {
    p_worker_id: WORKER_ID,
    p_batch_size: 10,
    p_lease_seconds: 120,
  });
  if (error) {
    console.error("claim_system_jobs failed", error.message);
    return;
  }

  for (const job of data ?? []) {
    try {
      if (job.job_type === "FINANCIAL_RECONCILIATION") {
        const { error: reconError } = await client.rpc(
          "run_financial_reconciliation",
          { p_request_id: crypto.randomUUID() },
        );
        if (reconError) {
          throw new Error(reconError.message);
        }
        // Reconciliation records mismatches only; never auto-repairs.
      }

      const { error: completeError } = await client.rpc("complete_system_job", {
        p_job_id: job.id,
        p_worker_id: WORKER_ID,
      });
      if (completeError) {
        throw new Error(completeError.message);
      }
    } catch (cause) {
      const code =
        cause instanceof Error
          ? cause.message.slice(0, 80)
          : "JOB_HANDLER_FAILED";
      await client.rpc("fail_system_job", {
        p_job_id: job.id,
        p_worker_id: WORKER_ID,
        p_error_code: code,
        p_error_class: "RETRYABLE",
        p_retry_delay_seconds: backoffSeconds(job.attempts + 1),
      });
    }
  }
}

async function main() {
  const client = createServiceClient();
  const startedAt = Date.now();
  let lastHeartbeat = 0;

  console.info(
    JSON.stringify({
      type: "worker.start",
      workerId: WORKER_ID,
      at: new Date().toISOString(),
    }),
  );

  for (;;) {
    if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
      await heartbeat(startedAt);
      lastHeartbeat = Date.now();
    }
    await processOutbox(client);
    await processJobs(client);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error("worker crashed", error);
  process.exit(1);
});
