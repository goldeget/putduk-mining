import type { SupabaseClient } from "@supabase/supabase-js";

export type FundingSchedulerSummary = {
  contract_version: 1;
  scanned: number;
  scheduled: number;
  blocked: number;
  busy: number;
  paused: boolean;
};

export function scheduleFundingJobs(
  client: SupabaseClient,
  options?: { batchSize?: number },
): Promise<FundingSchedulerSummary>;
