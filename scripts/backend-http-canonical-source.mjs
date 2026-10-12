/** Canonical CI 193-source entry point. No caller-selected execution context. */
import { assertBackendHttpCanonicalCandidateSources } from "./backend-http-local-source.mjs";

export function assertBackendHttpCanonicalSources(root) {
  return assertBackendHttpCanonicalCandidateSources(root);
}
