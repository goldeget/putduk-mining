export function requireLocalWorkerTestEnv(
  env?: Record<string, string | undefined>,
): { url: string; secret: string; container: string };
