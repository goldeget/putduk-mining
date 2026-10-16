import { loadJobLocalAllowlist } from "./capture-local-supabase-env.mjs";

/** Resolve from this checkout's configuration; caller overrides cannot change the target. */
export function resolveLocalDbTarget(configText, projectOverride) {
  const allowlist = loadJobLocalAllowlist(configText);
  if (
    projectOverride !== undefined &&
    projectOverride !== allowlist.projectId
  ) {
    throw new Error("LOCAL_DB_PROJECT_SCOPE_REJECTED");
  }
  return Object.freeze({
    ...allowlist,
    container: `supabase_db_${allowlist.projectId}`,
  });
}

export function assertLocalDbContainerMetadata(text, target) {
  let metadata;
  try {
    metadata = JSON.parse(text);
  } catch {
    throw new Error("LOCAL_DB_CONTAINER_METADATA_REJECTED");
  }
  if (
    metadata?.name !== `/${target.container}` ||
    metadata?.project !== target.projectId
  ) {
    throw new Error("LOCAL_DB_CONTAINER_METADATA_REJECTED");
  }
}
