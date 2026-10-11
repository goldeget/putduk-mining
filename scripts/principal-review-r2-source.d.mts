export function assertReviewedPrincipalCandidateSources(root?: string): {
  projectId: string;
  apiPort: number;
  runtimeSources: number;
  migrationSources: number;
  migrationVersions: string[];
  manifestSha256: string;
};
