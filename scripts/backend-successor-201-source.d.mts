export interface Backend201SourceBoundary {
  readonly scope: "LOCAL_QA" | "CANONICAL_CI";
  readonly repository: string;
  readonly projectId: string;
  readonly apiPort: number;
  readonly dbPort: number;
  readonly migrationSources: 201;
  readonly runtimeSources: 33;
  readonly evidenceSources: number;
  readonly manifestSha256: string;
  readonly previousManifestSha256: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly nativeHashes: Readonly<Record<string, string>>;
  readonly browserConsumerHashes: Readonly<Record<string, string>>;
  readonly migrationVersions: readonly string[];
}
export function assertBackend201CanonicalSources(
  root?: string,
): Backend201SourceBoundary;
export function assertBackend201LocalSources(
  root?: string,
): Backend201SourceBoundary;

export function assertBackend201Origin(
  origin: string,
  env?: Readonly<Record<string, string | undefined>>,
): void;
