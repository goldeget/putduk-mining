export type BackendHttp195Sources<Scope extends "CANONICAL_CI" | "LOCAL_QA"> = Readonly<{
  scope: Scope;
  repository: "goldeget/putduk-mining";
  projectId: Scope extends "CANONICAL_CI" ? "putduk-mining-ci-r2-20261009" : "putduk-mining-backend-patch-20261011";
  apiPort: Scope extends "CANONICAL_CI" ? 63421 : 65421;
  dbPort: Scope extends "CANONICAL_CI" ? 63422 : 65422;
  baselineRuntimeSources: 30;
  runtimeSources: 33;
  migrationSources: 195;
  evidenceSources: number;
  migrationVersions: readonly string[];
  manifestSha256: string;
  executionProfileSha256: Scope extends "CANONICAL_CI" ? null : string;
  previousManifestSha256: string;
  baselineManifestSha256: string;
}>;
export function assertBackendHttp195CanonicalCandidateSources(root?: string): BackendHttp195Sources<"CANONICAL_CI">;
export function assertBackendHttp195LocalCandidateSources(root?: string): BackendHttp195Sources<"LOCAL_QA">;
export type BackendHttp195SourceBoundary = BackendHttp195Sources<"CANONICAL_CI"> | BackendHttp195Sources<"LOCAL_QA">;
