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

type JobHandler = (
  client: SupabaseClient,
  job: {
    id: string;
    job_type: string;
    attempts: number;
  },
) => unknown;

type BatchOptions = {
  workerId?: string;
  batchSize?: number;
  leaseSeconds?: number;
  retryDelaySeconds?: number;
  outboxHandlers?: Record<string, OutboxHandler>;
  jobHandlers?: Record<string, JobHandler>;
};

export function backoffSeconds(attempt: number): number;

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
