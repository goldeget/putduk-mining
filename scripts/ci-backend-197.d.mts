import type { Backend197SourceBoundary } from "./backend-successor-197-source.mjs";
export const BACKEND197_UNIT_FILES: readonly string[];
export function planBackend197Gates(
  boundary: Backend197SourceBoundary,
): Record<string, unknown>;
export function assertBackend197NativeProof(
  report: unknown,
  files: Record<string, string>,
  context: {
    scope: "LOCAL_QA" | "CANONICAL_CI";
    boundary: Backend197SourceBoundary;
    containerId: string;
    startedAt: number;
    finishedAt: number;
    source: Record<string, unknown>;
    guardSha256: string;
    launcherSha256: string;
    executionBoundary?: Backend197SourceBoundary;
    derivatives: Record<
      string,
      { originalSha256: string; sha256: string; changes: unknown[] }
    >;
  },
): Record<string, unknown>;
export function verifyBackend197NativeDirectory(
  output: string,
  containerId: string,
): Record<string, unknown>;
export function recordBackend197HttpStart(): Record<string, unknown>;
export function verifyBackend197Http(): Record<string, unknown>;
export function assertBackend197HttpReport(
  report: unknown,
  intent: unknown,
  source: unknown,
  boundary: Backend197SourceBoundary,
  now: number,
): Record<string, unknown>;
