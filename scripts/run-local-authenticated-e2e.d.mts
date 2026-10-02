export function assertAppPort(value: unknown, fallback: string): string;

type EnvLike = Record<string, string | undefined>;

export function prepareLocalAuthenticatedEnv(options: {
  baseEnv: EnvLike;
  local: {
    apiUrl: string;
    publishableKey: string;
    secretKey: string;
    dbUrl: string;
  };
  projectId: string;
  withdrawalKey: string;
  webPort?: string;
  adminPort?: string;
  writeStdout?: (line: string) => void;
}): EnvLike;
