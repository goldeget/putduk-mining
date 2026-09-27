export const CLI_STATUS_ENV_FIELDS: {
  apiUrl: readonly string[];
  publishableKey: readonly string[];
  secretKey: readonly string[];
};

export function parseShellEnv(text: string): Record<string, string>;

export function mergeStatusStreams(
  stdout: string,
  stderr: string,
): Record<string, string>;

export function assertLocalApiUrl(apiUrl: string): string;

export function selectLocalCredentials(values: Record<string, string>): {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
};

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
};

export function formatGithubEnv(credentials: {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
}): string;

export function readSupabaseStatus(): {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
};
