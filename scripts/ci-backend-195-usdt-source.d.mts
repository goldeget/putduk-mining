import type { BackendHttp195SourceBoundary } from "./backend-http-195-source.mjs";
export function assertUsdt195CiBridgeSources(
  root: string,
  scope: "LOCAL_QA" | "CANONICAL_CI",
): Readonly<{
  candidate: BackendHttp195SourceBoundary;
  runnerManifestSha256: string;
  bridgeManifestSha256: string;
}>;
