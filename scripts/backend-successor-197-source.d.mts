export interface Backend197SourceBoundary {
  readonly scope: "LOCAL_QA" | "CANONICAL_CI";
  readonly repository: string;
  readonly projectId: string;
  readonly apiPort: number;
  readonly dbPort: number;
  readonly migrationSources: 197;
  readonly runtimeSources: 33;
  readonly evidenceSources: number;
  readonly manifestSha256: string;
  readonly previousManifestSha256: string;
  readonly sourceHashes?: Readonly<Record<string, string>>;
  readonly migrationVersions: readonly string[];
}
export function assertBackend197CanonicalSources(
  root?: string,
): Backend197SourceBoundary;
export function assertBackend197LocalSources(
  root?: string,
): Backend197SourceBoundary;
