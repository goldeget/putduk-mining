/**
 * PUTDUK MINING background worker entrypoint.
 *
 * Runs against local/service-role Postgres commands only.
 * Browser is not the runner. Cloudflare Queues are not used.
 *
 * Durable lease ownership comes from claim / complete / fail RPCs.
 * Stdout heartbeats are operational logs only — not lease evidence.
 * Missing RPCs (report to Agent A / parent; do not invent migrations here):
 *   - extend_outbox_event_lease / heartbeat_outbox_event_lease
 *   - extend_system_job_lease / heartbeat_system_job_lease
 *   - replay_outbox_event / replay_system_job (operator reset)
 *   - permanent reject for unsupported outbox (today exhausts to DEAD_LETTER)
 *   - outbox delivery / notification fanout commands
 */

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WORKER_ID =
  process.env.PUTDUK_WORKER_ID?.trim() || `putduk-worker-${process.pid}`;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 3_000;

/** Job types with a registered command handler. */
export const SUPPORTED_JOB_HANDLERS = Object.freeze({
  FINANCIAL_RECONCILIATION: handleFinancialReconciliation,
});

/**
 * Outbox event types with a registered command handler.
 * Empty until delivery/fanout RPCs exist — unsupported events must not complete.
 */
export const SUPPORTED_OUTBOX_HANDLERS = Object.freeze({});

export function requireEnv(name, env = process.env) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the worker.`);
  }
  return value;
}

export function createServiceClient(env = process.env) {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", env),
    requireEnv("SUPABASE_SECRET_KEY", env),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export function backoffSeconds(attempt) {
  const base = Math.min(3600, 2 ** Math.max(0, attempt - 1));
  return Math.max(5, base);
}

export function wantsOnce(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--once")) {
    return true;
  }
  const flag = env.PUTDUK_WORKER_ONCE?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/** Operational stdout only — not durable lease heartbeat evidence. */
export async function emitStdoutHeartbeat(workerId, startedAt) {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  console.info(
    JSON.stringify({
      type: "worker.heartbeat",
      durable: false,
      note: "stdout_only_not_lease_evidence",
      workerId,
      uptimeSec,
      at: new Date().toISOString(),
    }),
  );
}

async function handleFinancialReconciliation(client) {
  const { error } = await client.rpc("run_financial_reconciliation", {
    p_request_id: crypto.randomUUID(),
  });
  if (error) {
    throw new Error(error.message);
  }
  // Reconciliation records mismatches only; never auto-repairs.
}

function errorCode(cause, fallback) {
  if (cause instanceof Error && cause.message.trim()) {
    return cause.message.slice(0, 80);
  }
  return fallback;
}

/**
 * Claim and process one outbox batch.
 * Unsupported event types fail (retry → DLQ); they are never silently completed.
 */
export async function processOutboxBatch(
  client,
  {
    workerId = WORKER_ID,
    batchSize = 25,
    leaseSeconds = 60,
    outboxHandlers = SUPPORTED_OUTBOX_HANDLERS,
  } = {},
) {
  const summary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    unsupported: 0,
  };

  const { data, error } = await client.rpc("claim_outbox_events", {
    p_worker_id: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    console.error("claim_outbox_events failed", error.message);
    return { ...summary, claimError: error.message };
  }

  for (const event of data ?? []) {
    summary.claimed += 1;
    const handler = outboxHandlers[event.event_type];

    if (typeof handler !== "function") {
      summary.unsupported += 1;
      const { error: failError } = await client.rpc("fail_outbox_event", {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_error_code: "UNSUPPORTED_EVENT_TYPE",
        p_retry_delay_seconds: backoffSeconds(event.attempt_count),
      });
      if (failError) {
        console.error("fail_outbox_event failed", failError.message);
      } else {
        summary.failed += 1;
      }
      continue;
    }

    try {
      await handler(client, event);
      const { error: completeError } = await client.rpc(
        "complete_outbox_event",
        {
          p_event_id: event.id,
          p_worker_id: workerId,
        },
      );
      if (completeError) {
        throw new Error(completeError.message);
      }
      summary.completed += 1;
    } catch (cause) {
      const { error: failError } = await client.rpc("fail_outbox_event", {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_error_code: errorCode(cause, "OUTBOX_HANDLER_FAILED"),
        p_retry_delay_seconds: backoffSeconds(event.attempt_count),
      });
      if (failError) {
        console.error("fail_outbox_event failed", failError.message);
      } else {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

/**
 * Claim and process one durable job batch.
 */
export async function processJobBatch(
  client,
  {
    workerId = WORKER_ID,
    batchSize = 10,
    leaseSeconds = 120,
    jobHandlers = SUPPORTED_JOB_HANDLERS,
  } = {},
) {
  const summary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    unsupported: 0,
  };

  const { data, error } = await client.rpc("claim_system_jobs", {
    p_worker_id: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    console.error("claim_system_jobs failed", error.message);
    return { ...summary, claimError: error.message };
  }

  for (const job of data ?? []) {
    summary.claimed += 1;
    const handler = jobHandlers[job.job_type];

    if (typeof handler !== "function") {
      summary.unsupported += 1;
      const { error: failError } = await client.rpc("fail_system_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_error_code: "UNSUPPORTED_JOB_TYPE",
        p_error_class: "PERMANENT",
        p_retry_delay_seconds: backoffSeconds(job.attempts),
      });
      if (failError) {
        console.error("fail_system_job failed", failError.message);
      } else {
        summary.failed += 1;
      }
      continue;
    }

    try {
      await handler(client, job);
      const { error: completeError } = await client.rpc("complete_system_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
      });
      if (completeError) {
        throw new Error(completeError.message);
      }
      summary.completed += 1;
    } catch (cause) {
      const { error: failError } = await client.rpc("fail_system_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_error_code: errorCode(cause, "JOB_HANDLER_FAILED"),
        p_error_class: "RETRYABLE",
        p_retry_delay_seconds: backoffSeconds(job.attempts),
      });
      if (failError) {
        console.error("fail_system_job failed", failError.message);
      } else {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

/** One deterministic poll cycle: outbox then jobs. */
export async function runWorkerCycle(client, options = {}) {
  const workerId = options.workerId ?? WORKER_ID;
  const outbox = await processOutboxBatch(client, { ...options, workerId });
  const jobs = await processJobBatch(client, { ...options, workerId });
  return {
    workerId,
    at: new Date().toISOString(),
    outbox,
    jobs,
  };
}

export async function runDurableLoop({
  client = createServiceClient(),
  workerId = WORKER_ID,
  pollMs = POLL_MS,
  heartbeatMs = HEARTBEAT_MS,
  once = false,
} = {}) {
  const startedAt = Date.now();
  let lastHeartbeat = 0;

  console.info(
    JSON.stringify({
      type: "worker.start",
      workerId,
      once,
      at: new Date().toISOString(),
    }),
  );

  for (;;) {
    if (Date.now() - lastHeartbeat >= heartbeatMs) {
      await emitStdoutHeartbeat(workerId, startedAt);
      lastHeartbeat = Date.now();
    }

    const summary = await runWorkerCycle(client, { workerId });
    console.info(
      JSON.stringify({
        type: "worker.cycle",
        ...summary,
      }),
    );

    if (once) {
      console.info(
        JSON.stringify({
          type: "worker.once.summary",
          workerId,
          outboxClaimed: summary.outbox.claimed,
          outboxCompleted: summary.outbox.completed,
          outboxFailed: summary.outbox.failed,
          outboxUnsupported: summary.outbox.unsupported,
          jobsClaimed: summary.jobs.claimed,
          jobsCompleted: summary.jobs.completed,
          jobsFailed: summary.jobs.failed,
          jobsUnsupported: summary.jobs.unsupported,
          at: new Date().toISOString(),
        }),
      );
      return summary;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function isRunnerEntrypoint(
  metaUrl = import.meta.url,
  argv1 = process.argv[1],
) {
  if (!argv1) {
    return false;
  }
  try {
    return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
  } catch {
    return false;
  }
}

async function main() {
  const once = wantsOnce();
  await runDurableLoop({ once });
  if (once) {
    process.exit(0);
  }
}

if (isRunnerEntrypoint()) {
  main().catch((error) => {
    console.error("worker crashed", error);
    process.exit(1);
  });
}
