type EnvLike = Record<string, string | undefined>;

export function prepareWithdrawalProductEnv(options: {
  baseEnv: EnvLike;
  local: {
    apiUrl: string;
    publishableKey: string;
    secretKey: string;
    dbUrl: string;
  };
  withdrawalKey: string;
  writeStdout?: (line: string) => void;
}): EnvLike;
