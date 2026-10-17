import { assertBackend201CanonicalSources } from "./backend-successor-201-source.mjs";
export function readBackend201HttpContext() {
  if (
    process.env.PUTDUK_BACKEND_SOURCE_REVISION !== "201" ||
    process.env.APP_ENV !== "test"
  )
    throw Error("BACKEND201_EXPLICIT_TEST_HTTP_CONTEXT_REQUIRED");
  return assertBackend201CanonicalSources();
}
export function resolveBackend201Context(revision, legacy, current) {
  if (revision === undefined) return legacy();
  if (revision === "201") return current();
  throw Error("BACKEND201_EXPLICIT_REVISION_REJECTED");
}
