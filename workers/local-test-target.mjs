import {
  assertCiTestTarget,
  assertLocalApiUrl,
  loadJobLocalAllowlist,
} from "../scripts/capture-local-supabase-env.mjs";

/** Validate before creating either a service client or a SQL fixture session. */
export function requireLocalWorkerTestEnv(env = process.env) {
  const target = loadJobLocalAllowlist();
  assertCiTestTarget(env);
  for (const name of [
    "LOCAL_SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_REF",
  ]) {
    if (env[name] && env[name] !== target.projectId) {
      throw new Error("LOCAL_DB_PROJECT_SCOPE_REJECTED");
    }
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    throw new Error("Local Supabase worker credentials are required.");
  }
  return {
    url: assertLocalApiUrl(url, target),
    secret,
    container: `supabase_db_${target.projectId}`,
  };
}
