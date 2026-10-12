/** Exact 191-migration successor; previousManifestSha256 pins frozen 188. */
export function assertReviewedPrincipalCandidateSources(root?: string): {
  projectId: string;
  apiPort: number;
  runtimeSources: number;
  migrationSources: number;
  migrationVersions: string[];
  manifestSha256: string;
  baselineManifestSha256: string;
  previousManifestSha256: string;
};
