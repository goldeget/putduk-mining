type EnvLike = Record<string, string | undefined>;

export function assertProtectedRuntime(env: EnvLike): void;

export function scrubSecrets(text: string, secrets: readonly string[]): string;

export function protectedChildEnv(
  baseEnv: EnvLike,
  overrides: Record<string, string>,
): EnvLike;
