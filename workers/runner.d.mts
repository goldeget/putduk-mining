import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkerBatchSummary = {
  claimed: number;
  completed: number;
  failed: number;
  unsupported: number;
  claimError?: string;
};

export type WorkerCycleSummary = {
  workerId: string;
  at: string;
  outbox: WorkerBatchSummary;
  jobs: WorkerBatchSummary;
};

type OutboxHandler = (
  client: SupabaseClient,
  event: {
    id: string;
    event_type: string;
    attempt_count: number;
  },
) => unknown;

export type WorkerJobEnvelope = {
  id: string;
  job_type: string;
  attempts: number;
  payload_version?: number;
  idempotency_key?: string;
  payload?: unknown;
};

type JobHandler = (client: SupabaseClient, job: WorkerJobEnvelope) => unknown;

export const SUPPORTED_JOB_HANDLERS: Readonly<Record<string, JobHandler>>;

type BatchOptions = {
  workerId?: string;
  batchSize?: number;
  leaseSeconds?: number;
  retryDelaySeconds?: number;
  randomUnit?: number;
  leaseRenewIntervalMs?: number;
  outboxHandlers?: Record<string, OutboxHandler>;
  jobHandlers?: Record<string, JobHandler>;
};

export type LeaseRenewalStats = {
  extensions: number;
  failures: number;
  aborted: boolean;
};

export type LeaseRenewal = {
  stop: () => void;
  settle: () => Promise<void>;
  stats: LeaseRenewalStats;
};

export function backoffSeconds(attempt: number): number;

export function jitteredRetryDelaySeconds(
  attempt: number,
  randomUnit?: number,
): number;

export function classifyJobFailure(
  errorCode: string,
): "PERMANENT" | "RETRYABLE";

export function wantsOnce(
  argv?: readonly string[],
  env?: Record<string, string | undefined>,
): boolean;

export function processOutboxBatch(
  client: SupabaseClient,
  options?: BatchOptions,
): Promise<WorkerBatchSummary>;

export function processJobBatch(
  client: SupabaseClient,
  options?: BatchOptions,
): Promise<WorkerBatchSummary>;

export function runWorkerCycle(
  client: SupabaseClient,
  options?: BatchOptions,
): Promise<WorkerCycleSummary>;

export function resolveLeaseRenewIntervalMs(
  leaseSeconds: number,
  override?: number,
): number;

export function startPeriodicLeaseRenewal(options: {
  intervalMs: number;
  extend: () => Promise<void>;
  onExtensionFailure?: (
    error: unknown,
  ) => "abort" | "continue" | Promise<"abort" | "continue">;
}): LeaseRenewal;

export function stopAllLeaseRenewals(): void;

export function activeLeaseRenewalCount(): number;

export function workerCycleFailed(summary: WorkerCycleSummary): boolean;

export function runDurableLoop(options?: {
  client?: SupabaseClient;
  workerId?: string;
  pollMs?: number;
  heartbeatMs?: number;
  once?: boolean;
}): Promise<WorkerCycleSummary>;
