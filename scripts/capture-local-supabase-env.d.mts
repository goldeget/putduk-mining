export const LIVE_EXTERNAL_ENV_KEYS: readonly string[];

export const CLI_STATUS_ENV_FIELDS: {
  apiUrl: readonly string[];
  publishableKey: readonly string[];
  secretKey: readonly string[];
  dbUrl: readonly string[];
};

export type JobLocalAllowlist = {
  projectId: string;
  apiPort: string;
  dbPort: string;
};

export function parseShellEnv(text: string): Record<string, string>;

export function mergeStatusStreams(
  stdout: string,
  stderr: string,
): Record<string, string>;

export function loadJobLocalAllowlist(configText?: string): JobLocalAllowlist;

export function hasRemoteProjectRef(value: unknown): boolean;

export function assertLocalApiUrl(
  apiUrl: string,
  allowlist?: JobLocalAllowlist,
): string;

export function assertLocalDbUrl(
  dbUrl: string,
  allowlist?: JobLocalAllowlist,
): string;

type EnvLike = Record<string, string | undefined>;

export function assertCiTestTarget(env?: EnvLike): void;

export function canMaskSecret(value: string): boolean;

export function formatAddMask(value: string): string;

export function registerActionMasks(
  values: readonly string[],
  writeStdout: (line: string) => void,
  maskOnly?: readonly string[],
): void;

export function omitLiveProviders(env: EnvLike): EnvLike;

export function blankLiveProviderAssignments(): string;

export function credentialMaskValues(credentials: {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  dbUrl: string;
}): string[];

export function buildIsolatedTestEnv(
  baseEnv: EnvLike,
  credentials: {
    apiUrl: string;
    publishableKey: string;
    secretKey: string;
    dbUrl: string;
  },
  overrides?: Record<string, string>,
): EnvLike;

export function selectLocalCredentials(values: Record<string, string>): {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  dbUrl: string;
};

export function redactSupabaseCliLine(line: string): string;

export function redactStatusText(text: string): string;

export function captureFromCliResult(result: {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: unknown;
}): {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  dbUrl: string;
};

export function formatGithubEnv(
  credentials: {
    apiUrl: string;
    publishableKey: string;
    secretKey: string;
    dbUrl: string;
    projectId?: string;
  },
  env?: EnvLike,
): string;

export function readSupabaseStatus(): {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  dbUrl: string;
};
