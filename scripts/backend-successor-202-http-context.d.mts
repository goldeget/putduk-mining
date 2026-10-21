import type { Backend201SourceBoundary } from "./backend-successor-201-source.mjs";
import type { Backend202SourceBoundary } from "./backend-successor-202-source.mjs";
export function readBackend202HttpContext(): Backend202SourceBoundary;
export function resolveBackend202Context<L, R, H = Backend201SourceBoundary>(
  revision: string | undefined,
  legacy: () => L,
  current: () => R,
  historical201?: () => H,
): L | R | H;
