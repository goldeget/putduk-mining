import type { BackendHttp195SourceBoundary } from "./backend-http-195-source.mjs";
export function planBackend195Gates(boundary: BackendHttp195SourceBoundary): Readonly<{
  version: 1; candidate: string; purpose: string; state: string;
  sourceBoundary: BackendHttp195SourceBoundary;
  gates: readonly Readonly<{ id: string; command: readonly string[]; required: boolean }>[];
  releaseEvidence: string; integrationPending: readonly string[];
}>;
export function assertBackend195ExecutionReport(
  report: unknown, boundary: BackendHttp195SourceBoundary, source: unknown,
): Readonly<{ candidate: string; reportContract: string; release: string }>;
export function assertBackend195HttpCoverage(
  expected: readonly unknown[], actual: readonly unknown[],
): Readonly<{ tests: number; skipped: number; flaky: number }>;
