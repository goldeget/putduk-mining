export type ConcurrencyTarget = Readonly<{
  container: string;
  projectId: string;
  projectRef: string;
  dbPort: string;
}>;
export function assertConcurrencyScope(input: {
  env: Record<string, string | undefined>;
  origin: string;
  configText: string;
}): ConcurrencyTarget;
export function assertContainerMetadata(
  text: string,
  target: ConcurrencyTarget,
): void;
export function buildConcurrencySql(input: {
  container: string;
  runId: string;
  seedDigest: string;
  approvalDigest: string;
}): string;
export function verifyConcurrencyOutput(text: string): unknown;
export function runConcurrencyProbe(input?: {
  env?: Record<string, string | undefined>;
  execute?: (
    command: string,
    args: readonly string[],
    options: Record<string, unknown>,
  ) => string;
}): unknown;
