export const CI_REPOSITORY: string;
export const CI_ORIGIN: string;
export const CI_BUDGET_MS: number;
export const CI_CANCEL_AT_MS: number;
export const CI_BUDGET_JOB: string;
export const CI_REQUIRED_JOBS: readonly string[];

export type CiIdentity = { runId: string; attempt: number; headSha: string };
export type CiRun = {
  id: number;
  run_attempt: number;
  head_sha: string;
  path: string;
  event: string;
  created_at: string;
  run_started_at: string;
  repository: { full_name: string };
  head_repository: { full_name: string };
  status: string;
};
export type CiJob = {
  name: string;
  status: string;
  conclusion: string | null;
  completed_at: string | null;
};
export type CiEvaluation = {
  elapsedMs: number;
  pending: string[];
  problems: string[];
  complete: boolean;
  accepted: boolean;
  cancel: boolean;
};
export type CiRequest = (path: string, method?: string) => Promise<unknown>;

export function assertCiRunIdentity(run: CiRun, identity: CiIdentity): void;
export function evaluateCiJobs(
  run: CiRun,
  jobs: readonly CiJob[],
  nowMs: number,
): CiEvaluation;
export function createCiApi(options: {
  token: string;
  fetchImpl?: (
    url: string,
    options: {
      method: string;
      redirect: "error";
      headers: Record<string, string>;
      signal: AbortSignal;
    },
  ) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
}): CiRequest;
export function monitorCi(options: {
  identity: CiIdentity;
  request: CiRequest;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  report?: (line: string) => void;
}): Promise<CiEvaluation>;
