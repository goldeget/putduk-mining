import type { Backend202SourceBoundary } from "./backend-successor-202-source.mjs";
export const BACKEND202_UNIT_FILES: readonly string[];
export function planBackend202Gates(
  boundary: Backend202SourceBoundary,
): Record<string, unknown>;
export function assertBackend202NativeProof(
  report: unknown,
  files: Record<string, string>,
  context: {
    scope: "LOCAL_QA" | "CANONICAL_CI";
    boundary: Backend202SourceBoundary;
    containerId: string;
    startedAt: number;
    finishedAt: number;
    source: Record<string, unknown>;
    guardSha256: string;
    launcherSha256: string;
    executionBoundary?: Backend202SourceBoundary;
    derivatives: Record<
      string,
      { originalSha256: string; sha256: string; changes: unknown[] }
    >;
  },
): Record<string, unknown>;
export function verifyBackend202NativeDirectory(
  output: string,
  containerId: string,
): Record<string, unknown>;
export function recordBackend202HttpStart(): Record<string, unknown>;
export function verifyBackend202Http(): Record<string, unknown>;
export function assertBackend202HttpReport(
  report: unknown,
  intent: unknown,
  source: unknown,
  boundary: Backend202SourceBoundary,
  now: number,
): Record<string, unknown>;
