import { readBackend201HttpContext } from "./backend-successor-201-http-context.mjs";
import { assertBackend202CanonicalSources } from "./backend-successor-202-source.mjs";
export function readBackend202HttpContext() {
  if (
    process.env.PUTDUK_BACKEND_SOURCE_REVISION !== "202" ||
    process.env.APP_ENV !== "test"
  )
    throw Error("BACKEND202_EXPLICIT_TEST_HTTP_CONTEXT_REQUIRED");
  return assertBackend202CanonicalSources();
}
export function resolveBackend202Context(
  revision,
  legacy,
  current,
  historical201 = readBackend201HttpContext,
) {
  if (revision === undefined) return legacy();
  if (revision === "202") return current();
  if (revision === "201") return historical201();
  throw Error("BACKEND202_EXPLICIT_REVISION_REJECTED");
}
