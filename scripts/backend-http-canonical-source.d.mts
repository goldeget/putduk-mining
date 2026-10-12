export type BackendHttpCanonicalSources = Readonly<{
  scope: "CANONICAL_CI";
  repository: "goldeget/putduk-mining";
  projectId: "putduk-mining-ci-r2-20261009";
  apiPort: 63421;
  dbPort: 63422;
  baselineRuntimeSources: 29;
  runtimeSources: 30;
  migrationSources: 193;
  migrationVersions: string[];
  manifestSha256: string;
  executionProfileSha256: null;
  previousManifestSha256: string;
  baselineManifestSha256: string;
}>;

export function assertBackendHttpCanonicalSources(
  root?: string,
): BackendHttpCanonicalSources;
