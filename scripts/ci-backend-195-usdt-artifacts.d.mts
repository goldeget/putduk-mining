export const USDT195_CI_PINS: Readonly<{
  candidate: string;
  runner: string;
  guard: string;
}>;
export type Usdt195CiArtifactBundle = {
  manifest: Buffer;
  files: Record<string, Buffer>;
};
export type Usdt195CiArtifactContext = {
  scope: "CANONICAL_CI" | "LOCAL_QA";
  source: unknown;
  boundary: unknown;
  expectedContainerId: string;
  startedAt: number;
  finishedAt: number;
  childExitCode: number;
  childStdoutSha256: string;
  childStderrSha256: string;
  expectedDerivatives: Record<
    string,
    { originalSha256: string; sha256: string; changes: unknown[] }
  >;
  launcherSha256: string;
  concurrencyContract: unknown;
};
export function assertUsdt195CiArtifacts(
  bundle: Usdt195CiArtifactBundle,
  context: Usdt195CiArtifactContext,
): Readonly<{
  candidate: string;
  scope: string;
  artifactContract: string;
  source: unknown;
  runnerRunId: string;
  containerId: string;
  artifactManifestSha256: string;
  executionSha256: string;
  evidenceBasis: string;
  gates: readonly Readonly<{
    id: string;
    status: string;
    exitCode: number;
    executed: boolean;
    skipped: number;
    flaky: number;
    expectedFailures: number;
    startedAt: number;
    finishedAt: number;
    evidenceSha256: string;
  }>[];
  release: string;
  wholeCi: string;
}>;
