import type { Backend201SourceBoundary } from "./backend-successor-201-source.mjs";
export function readBackend201HttpContext(): Backend201SourceBoundary;
export function resolveBackend201Context<L, R>(
  revision: string | undefined,
  legacy: () => L,
  current: () => R,
): L | R;
