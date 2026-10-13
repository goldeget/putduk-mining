import type { Backend201SourceBoundary } from "./backend-successor-201-source.mjs";
export const BACKEND201_UNIT_FILES: readonly string[];
export function planBackend201Gates(
  boundary: Backend201SourceBoundary,
): Record<string, unknown>;
export function assertBackend201NativeProof(
  report: unknown,
  files: Record<string, string>,
  context: {
    scope: "LOCAL_QA" | "CANONICAL_CI";
    boundary: Backend201SourceBoundary;
    containerId: string;
    startedAt: number;
    finishedAt: number;
    source: Record<string, unknown>;
    guardSha256: string;
    launcherSha256: string;
    executionBoundary?: Backend201SourceBoundary;
    derivatives: Record<
      string,
      { originalSha256: string; sha256: string; changes: unknown[] }
    >;
  },
): Record<string, unknown>;
export function verifyBackend201NativeDirectory(
  output: string,
  containerId: string,
): Record<string, unknown>;
export function recordBackend201HttpStart(): Record<string, unknown>;
export function verifyBackend201Http(): Record<string, unknown>;
export function assertBackend201HttpReport(
  report: unknown,
  intent: unknown,
  source: unknown,
  boundary: Backend201SourceBoundary,
  now: number,
): Record<string, unknown>;
