/**
 * PUTDUK MINING background worker entrypoint.
 *
 * Runs against local/service-role Postgres commands only.
 * Browser is not the runner. Cloudflare Queues are not used.
 *
 * Durable lease ownership comes from claim / complete / fail RPCs.
 * Each claimed row refreshes its lease through extend_*_lease.
 * A handler that outlives the original lease renews it on an interval.
 * The interval is cleared on success, failure, and worker shutdown.
 * Stdout heartbeats are operational logs only — not lease evidence.
 * 지원하지 않는 아웃박스와 PERMANENT 작업은 그 시도에서 DEAD_LETTER가 된다.
 * 재시도 지연은 상한 있는 지수 백오프에 지터를 더한 값이다.
 * 같은 재조정 작업의 재시도는 작업 id를 요청 id로 다시 쓴다.
 * Device push delivery uses its separately fenced command consumer.
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
  FUNDING_MINING_TICK_V1: prepareFundingMiningTick,
  LIVEOPS_PUBLICATION_FANOUT_V1: prepareLiveopsPublicationFanout,
});

const FUNDING_JOB_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function prepareLiveopsPublicationFanout(_client, job) {
  const p = job?.payload;
  if (
    job?.job_type !== "LIVEOPS_PUBLICATION_FANOUT_V1" ||
    typeof job.id !== "string" ||
    !FUNDING_JOB_UUID.test(job.id) ||
    job.payload_version !== 1 ||
    !Number.isSafeInteger(job.attempts) ||
    job.attempts < 1 ||
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    Object.keys(p).length !== 4 ||
    typeof p.revision_id !== "string" ||
    !FUNDING_JOB_UUID.test(p.revision_id) ||
    typeof p.source_event_id !== "string" ||
    !FUNDING_JOB_UUID.test(p.source_event_id) ||
    !Number.isSafeInteger(p.chunk_number) ||
    p.chunk_number < 1 ||
    !Object.hasOwn(p, "after_user_id") ||
    (p.after_user_id !== null &&
      (typeof p.after_user_id !== "string" ||
        !FUNDING_JOB_UUID.test(p.after_user_id))) ||
    (p.chunk_number === 1 && p.after_user_id !== null) ||
    (p.chunk_number > 1 && p.after_user_id === null) ||
    job.idempotency_key !== `liveops-fanout:${p.revision_id}:${p.chunk_number}`
  ) {
    throw new Error("LIVEOPS_FANOUT_JOB_ENVELOPE_INVALID");
  }
  // The current leased DB completion validates the sealed cohort and commits
  // one bounded chunk plus its deterministic continuation in one transaction.
}

function prepareLiveopsPublicationDelivery(_client, event) {
  const p = event?.payload;
  const fields = [
    "receipt_id",
    "audit_id",
    "content_kind",
    "content_id",
    "state",
    "digest",
  ];
  if (
    event?.event_type !== "LIVEOPS_CONTENT_CHANGED.v1" ||
    event.schema_version !== 1 ||
    event.aggregate_type !== "liveops_content" ||
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    Object.keys(p).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(p, field)) ||
    ["receipt_id", "audit_id", "content_id"].some(
      (field) =>
        typeof p[field] !== "string" || !FUNDING_JOB_UUID.test(p[field]),
    ) ||
    event.aggregate_id !== p.content_id ||
    !["NOTICE", "EVENT"].includes(p.content_kind) ||
    ![
      "DRAFT",
      "PREVIEWED",
      "APPROVED",
      "PUBLISHED",
      "CANCELLED",
      "ARCHIVED",
    ].includes(p.state) ||
    typeof p.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.digest)
  ) {
    throw new Error("LIVEOPS_PUBLICATION_ENVELOPE_INVALID");
  }
  // JavaScript is envelope validation only, never a publication success receipt.
}

function prepareFundingMiningTick(_client, job) {
  const payload = job?.payload;
  const fields = ["user_id", "activation_id", "expected_state_id"];
  if (
    job?.job_type !== "FUNDING_MINING_TICK_V1" ||
    typeof job.id !== "string" ||
    !FUNDING_JOB_UUID.test(job.id) ||
    job.payload_version !== 1 ||
    !Number.isSafeInteger(job.attempts) ||
    job.attempts < 1 ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== fields.length ||
    fields.some(
      (field) =>
        !Object.hasOwn(payload, field) ||
        typeof payload[field] !== "string" ||
        !FUNDING_JOB_UUID.test(payload[field]),
    ) ||
    job.idempotency_key !== `funding:state:${payload.expected_state_id}`
  )
    throw new Error("FUNDING_JOB_ENVELOPE_INVALID");
  // No calculation or monetary RPC here. The existing complete_system_job
  // command verifies originals and commits the producer with the current fence.
  // Registration does not release jobs held at infinity or create new jobs.
}

/**
 * Outbox event types with a registered command handler.
 * Internal safe-mode audit acknowledgement is committed by the existing
 * complete_outbox_event command. Reward qualification stays inside the DB.
 */
export const SUPPORTED_OUTBOX_HANDLERS = Object.freeze({
  "SAFE_MODE_CHANGED.v1": prepareSafeModeAuditDelivery,
  "LIVEOPS_CONTENT_CHANGED.v1": prepareLiveopsPublicationDelivery,
  "EVENT_PARTICIPATION_JOINED.v1": prepareMemberEventJoinDelivery,
  "DEPOSIT_CONFIRMED.v1": prepareNonmoneyOriginalDelivery,
  "USDT_MANUAL_DEPOSIT_CONFIRMED.v1": prepareNonmoneyOriginalDelivery,
  "WITHDRAWAL_COMPLETED.v1": prepareNonmoneyOriginalDelivery,
  "TRIAL_REWARD_CONVERTED.v1": prepareNonmoneyOriginalDelivery,
  "MINING_STARTED.v1": prepareNonmoneyOriginalDelivery,
  "MINING_SETTLEMENT_COMPLETED.v1": prepareNonmoneyOriginalDelivery,
  "TRIAL_COMPLETED.v1": prepareNonmoneyOriginalDelivery,
});

function prepareNonmoneyOriginalDelivery(_client, event) {
  const contracts = {
    "TRIAL_COMPLETED.v1": {
      aggregate: "trial_completion",
      fields: ["user_id", "original_id", "completion_id", "digest"],
      uuids: ["user_id", "original_id", "completion_id"],
      amounts: [],
    },
    "MINING_STARTED.v1": {
      aggregate: "funded_mining_mission",
      fields: [
        "user_id",
        "original_id",
        "earned_receipt_id",
        "settlement_id",
        "digest",
      ],
      uuids: ["user_id", "original_id", "earned_receipt_id", "settlement_id"],
      amounts: [],
    },
    "MINING_SETTLEMENT_COMPLETED.v1": {
      aggregate: "funded_mining_mission",
      fields: [
        "user_id",
        "original_id",
        "earned_receipt_id",
        "settlement_id",
        "digest",
      ],
      uuids: ["user_id", "original_id", "earned_receipt_id", "settlement_id"],
      amounts: [],
    },
    "USDT_MANUAL_DEPOSIT_CONFIRMED.v1": {
      aggregate: "usdt_manual_deposit",
      fields: ["user_id", "credited_krw", "ledger_transaction_id"],
      uuids: ["user_id", "ledger_transaction_id"],
      amounts: ["credited_krw"],
    },
    "DEPOSIT_CONFIRMED.v1": {
      aggregate: "deposit_request",
      fields: [
        "user_id",
        "currency",
        "approved_amount_atomic",
        "requested_amount_atomic",
        "ledger_transaction_id",
        "wallet_ledger_id",
      ],
      uuids: ["user_id", "ledger_transaction_id", "wallet_ledger_id"],
      amounts: ["approved_amount_atomic", "requested_amount_atomic"],
    },
    "WITHDRAWAL_COMPLETED.v1": {
      aggregate: "withdrawal_request",
      fields: ["finalize_ledger_transaction_id", "amount_atomic"],
      uuids: ["finalize_ledger_transaction_id"],
      amounts: ["amount_atomic"],
    },
    "TRIAL_REWARD_CONVERTED.v1": {
      aggregate: "trial_reward_conversion",
      fields: [
        "user_id",
        "amount_atomic",
        "currency",
        "funding_required",
        "ledger_transaction_id",
      ],
      uuids: ["user_id", "ledger_transaction_id"],
      amounts: ["amount_atomic"],
    },
  };
  const contract = contracts[event.event_type];
  const payload = event.payload;
  if (
    !contract ||
    event.schema_version !== 1 ||
    event.aggregate_type !== contract.aggregate ||
    !FUNDING_JOB_UUID.test(event.id ?? "") ||
    !FUNDING_JOB_UUID.test(event.aggregate_id ?? "") ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== contract.fields.length ||
    contract.fields.some((field) => !Object.hasOwn(payload, field)) ||
    contract.uuids.some(
      (field) => !FUNDING_JOB_UUID.test(payload[field] ?? ""),
    ) ||
    contract.amounts.some(
      (field) =>
        typeof payload[field] !== "string" ||
        !/^[1-9][0-9]*$/.test(payload[field]),
    ) ||
    (contract.fields.includes("digest") &&
      (payload[
        contract.aggregate === "trial_completion"
          ? "completion_id"
          : "original_id"
      ] !== event.aggregate_id ||
        typeof payload.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(payload.digest))) ||
    (contract.fields.includes("currency") && payload.currency !== "KRW") ||
    (event.event_type === "TRIAL_REWARD_CONVERTED.v1" &&
      payload.funding_required !== false)
  ) {
    throw new Error("NONMONEY_SOURCE_ENVELOPE_INVALID");
  }
  // A matching payload never proves qualification. Completion verifies the
  // canonical money writer's original, owner, business clock and current policy.
}

function prepareMemberEventJoinDelivery(_client, event) {
  const fields = [
    "event_id",
    "participant_id",
    "user_id",
    "content_revision_id",
    "reward_mode",
    "join_original_id",
    "audit_id",
    "digest",
  ];
  if (
    event.event_type !== "EVENT_PARTICIPATION_JOINED.v1" ||
    event.schema_version !== 1 ||
    event.aggregate_type !== "event_participant" ||
    !event.payload ||
    Object.keys(event.payload).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(event.payload, field)) ||
    fields
      .filter((field) => !["digest", "reward_mode"].includes(field))
      .some(
        (field) =>
          typeof event.payload[field] !== "string" ||
          !FUNDING_JOB_UUID.test(event.payload[field]),
      ) ||
    event.payload.reward_mode !== "NONE" ||
    typeof event.payload.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(event.payload.digest)
  ) {
    throw new Error("EVENT_JOIN_ENVELOPE_INVALID");
  }
  // Existing completion RPC verifies the sealed DB original and writes one
  // internal delivery receipt. Joining does not qualify or grant a reward.
}

function prepareSafeModeAuditDelivery(_client, event) {
  // This is only envelope preflight. The DB completion command verifies the
  // actual immutable command receipt and persists the deduplicated effect.
  if (
    event.event_type !== "SAFE_MODE_CHANGED.v1" ||
    event.schema_version !== 1 ||
    event.aggregate_type !== "safe_mode_control" ||
    typeof event.payload?.audit_id !== "string" ||
    typeof event.payload?.is_paused !== "boolean"
  )
    throw new Error("SAFE_MODE_EVENT_ENVELOPE_INVALID");
}

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

/**
 * 기준 지연보다 짧아지지 않는 지터를 더한다.
 * randomUnit은 [0, 1)이며, 결과는 5초 이상 3600초 이하다.
 */
export function jitteredRetryDelaySeconds(attempt, randomUnit = Math.random()) {
  const base = backoffSeconds(attempt);
  if (!Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit >= 1) {
    throw new Error("INVALID_RETRY_JITTER");
  }
  const room = Math.max(0, 3600 - base);
  const spread = Math.min(base, room);
  return base + Math.floor(randomUnit * spread);
}

/** 다시 시도해도 같은 오류가 나는 작업만 영구 실패로 분류한다. */
export function classifyJobFailure(errorCode) {
  if (
    errorCode === "UNSUPPORTED_JOB_TYPE" ||
    errorCode === "RECONCILIATION_JOB_ID_REQUIRED" ||
    errorCode === "FUNDING_JOB_ENVELOPE_INVALID" ||
    errorCode === "LIVEOPS_FANOUT_JOB_ENVELOPE_INVALID"
  ) {
    return "PERMANENT";
  }
  return "RETRYABLE";
}

function resolveRetryDelaySeconds(attempt, override, randomUnit) {
  if (typeof override === "number") {
    return override;
  }
  return jitteredRetryDelaySeconds(attempt, randomUnit);
}

export function wantsOnce(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--once")) {
    return true;
  }
  const flag = env.PUTDUK_WORKER_ONCE?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

const activeLeaseRenewals = new Set();

export function activeLeaseRenewalCount() {
  return activeLeaseRenewals.size;
}

export function resolveLeaseRenewIntervalMs(leaseSeconds, override) {
  if (override === undefined) {
    return Math.max(1_000, Math.floor((Number(leaseSeconds) * 1000) / 3));
  }
  if (!Number.isFinite(override) || override < 50) {
    throw new Error("INVALID_LEASE_RENEW_INTERVAL");
  }
  return override;
}

/**
 * 처리 중 lease를 주기적으로 늘린다.
 * stop/settle은 타이머를 제거하고, 진행 중인 연장 호출이 끝난 뒤에 반환한다.
 */
export function startPeriodicLeaseRenewal({
  intervalMs,
  extend,
  onExtensionFailure,
}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 50) {
    throw new Error("INVALID_LEASE_RENEW_INTERVAL");
  }

  let timer = null;
  let stopped = false;
  let inFlight = Promise.resolve();
  const stats = { extensions: 0, failures: 0, aborted: false };
  let record = null;

  async function tick() {
    if (stopped) {
      return;
    }
    try {
      await extend();
      stats.extensions += 1;
    } catch (error) {
      stats.failures += 1;
      const decision = onExtensionFailure
        ? await onExtensionFailure(error)
        : "abort";
      if (decision !== "continue") {
        stats.aborted = true;
        stop();
      }
    }
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (record) {
      activeLeaseRenewals.delete(record);
    }
  }

  async function settle() {
    stop();
    await inFlight;
  }

  record = { stop, settle, stats };
  timer = setInterval(() => {
    if (stopped) {
      return;
    }
    inFlight = inFlight.then(() => tick());
  }, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  activeLeaseRenewals.add(record);
  return record;
}

export function stopAllLeaseRenewals() {
  for (const renewal of [...activeLeaseRenewals]) {
    renewal.stop();
  }
}

function installLeaseShutdownOnce() {
  if (installLeaseShutdownOnce.installed) {
    return;
  }
  installLeaseShutdownOnce.installed = true;
  const shutdown = (signal) => {
    stopAllLeaseRenewals();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

installLeaseShutdownOnce.installed = false;

async function runHandlerWithLeaseRenewal({
  leaseSeconds,
  leaseRenewIntervalMs,
  extend,
  handler,
}) {
  const renewal = startPeriodicLeaseRenewal({
    intervalMs: resolveLeaseRenewIntervalMs(leaseSeconds, leaseRenewIntervalMs),
    extend,
    onExtensionFailure: () => "abort",
  });
  try {
    await handler();
    await renewal.settle();
    if (renewal.stats.aborted) {
      throw new Error("LEASE_EXTENSION_FAILED");
    }
  } catch (cause) {
    await renewal.settle();
    throw cause;
  }
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

async function handleFinancialReconciliation(client, job) {
  const requestId = typeof job?.id === "string" ? job.id.trim() : "";
  if (!requestId) {
    throw new Error("RECONCILIATION_JOB_ID_REQUIRED");
  }
  // 재시도도 같은 작업 id를 요청 id로 보낸다. 대조 명령이 기존 성공 실행을 반환한다.
  const { error } = await client.rpc("run_financial_reconciliation", {
    p_request_id: requestId,
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
 * 지원하지 않는 유형과 호환되지 않는 안전한 모드 봉투는 즉시 DEAD_LETTER다.
 * 그 외 실패는 지터가 있는 백오프로 재시도하고, 조용히 완료하지 않는다.
 */
export async function processOutboxBatch(
  client,
  {
    workerId = WORKER_ID,
    batchSize = 25,
    leaseSeconds = 60,
    retryDelaySeconds,
    randomUnit,
    outboxHandlers = SUPPORTED_OUTBOX_HANDLERS,
    leaseRenewIntervalMs,
  } = {},
) {
  const summary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    unsupported: 0,
  };

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new Error("INVALID_WORKER_BATCH_SIZE");
  }

  // Claim only the item that can start now. batchSize bounds the cycle's work;
  // waiting rows keep their original availability and never consume a lease.
  while (summary.claimed < batchSize) {
    const { data, error } = await client.rpc("claim_outbox_events", {
      p_worker_id: workerId,
      p_batch_size: 1,
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      console.error("claim_outbox_events failed", error.message);
      summary.claimError = error.message;
      break;
    }
    const event = data?.[0];
    if (!event) {
      break;
    }
    summary.claimed += 1;
    const { error: extendError } = await client.rpc(
      "extend_outbox_event_lease",
      {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (extendError) {
      summary.failed += 1;
      console.error("extend_outbox_event_lease failed", extendError.message);
      break;
    }
    const handler = outboxHandlers[event.event_type];

    if (typeof handler !== "function") {
      summary.unsupported += 1;
      const { error: failError } = await client.rpc("fail_outbox_event", {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_error_code: "UNSUPPORTED_EVENT_TYPE",
        p_retry_delay_seconds: resolveRetryDelaySeconds(
          event.attempt_count,
          retryDelaySeconds,
          randomUnit,
        ),
      });
      summary.failed += 1;
      if (failError) {
        console.error("fail_outbox_event failed", failError.message);
      }
      continue;
    }

    try {
      await runHandlerWithLeaseRenewal({
        leaseSeconds,
        leaseRenewIntervalMs,
        extend: async () => {
          const { error } = await client.rpc("extend_outbox_event_lease", {
            p_event_id: event.id,
            p_worker_id: workerId,
            p_lease_seconds: leaseSeconds,
          });
          if (error) {
            throw new Error(error.message);
          }
        },
        handler: async () => {
          await handler(client, event);
        },
      });
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
        p_retry_delay_seconds: resolveRetryDelaySeconds(
          event.attempt_count,
          retryDelaySeconds,
          randomUnit,
        ),
      });
      summary.failed += 1;
      if (failError) {
        console.error("fail_outbox_event failed", failError.message);
      }
      break;
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
    leaseRenewIntervalMs,
    randomUnit,
  } = {},
) {
  const summary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    unsupported: 0,
  };

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("INVALID_WORKER_BATCH_SIZE");
  }

  // Claim only the item that can start now. batchSize bounds the cycle's work;
  // waiting rows keep their original availability and never consume a lease.
  while (summary.claimed < batchSize) {
    const { data, error } = await client.rpc("claim_system_jobs", {
      p_worker_id: workerId,
      p_batch_size: 1,
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      console.error("claim_system_jobs failed", error.message);
      summary.claimError = error.message;
      break;
    }
    const job = data?.[0];
    if (!job) {
      break;
    }
    summary.claimed += 1;
    const { error: extendError } = await client.rpc("extend_system_job_lease", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    if (extendError) {
      summary.failed += 1;
      console.error("extend_system_job_lease failed", extendError.message);
      break;
    }
    const handler = jobHandlers[job.job_type];

    if (typeof handler !== "function") {
      summary.unsupported += 1;
      const { error: failError } = await client.rpc("fail_system_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_error_code: "UNSUPPORTED_JOB_TYPE",
        p_error_class: classifyJobFailure("UNSUPPORTED_JOB_TYPE"),
        p_retry_delay_seconds: resolveRetryDelaySeconds(
          job.attempts,
          undefined,
          randomUnit,
        ),
      });
      summary.failed += 1;
      if (failError) {
        console.error("fail_system_job failed", failError.message);
      }
      continue;
    }

    try {
      await runHandlerWithLeaseRenewal({
        leaseSeconds,
        leaseRenewIntervalMs,
        extend: async () => {
          const { error } = await client.rpc("extend_system_job_lease", {
            p_job_id: job.id,
            p_worker_id: workerId,
            p_lease_seconds: leaseSeconds,
          });
          if (error) {
            throw new Error(error.message);
          }
        },
        handler: async () => {
          await handler(client, job);
        },
      });
      const { error: completeError } = await client.rpc("complete_system_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
      });
      if (completeError) {
        throw new Error(completeError.message);
      }
      summary.completed += 1;
    } catch (cause) {
      const failureCode = errorCode(cause, "JOB_HANDLER_FAILED");
      const { error: failError } = await client.rpc("fail_system_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_error_code: failureCode,
        p_error_class: classifyJobFailure(failureCode),
        p_retry_delay_seconds: resolveRetryDelaySeconds(
          job.attempts,
          undefined,
          randomUnit,
        ),
      });
      summary.failed += 1;
      if (failError) {
        console.error("fail_system_job failed", failError.message);
      }
      break;
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

export function workerCycleFailed(summary) {
  return [summary.outbox, summary.jobs].some(
    (batch) =>
      Boolean(batch.claimError) || batch.failed > 0 || batch.unsupported > 0,
  );
}

export async function runDurableLoop({
  client = createServiceClient(),
  workerId = WORKER_ID,
  pollMs = POLL_MS,
  heartbeatMs = HEARTBEAT_MS,
  once = false,
} = {}) {
  installLeaseShutdownOnce();
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
      stopAllLeaseRenewals();
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
      if (workerCycleFailed(summary)) {
        throw new Error("WORKER_ONCE_FAILED");
      }
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
