import type { JobLocalAllowlist } from "./capture-local-supabase-env.mjs";
export type LocalDbTarget = JobLocalAllowlist & { readonly container: string };
export function resolveLocalDbTarget(
  configText?: string,
  projectOverride?: string,
): LocalDbTarget;
export function assertLocalDbContainerMetadata(
  text: string,
  target: LocalDbTarget,
): void;
