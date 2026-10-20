export interface Backend202SourceBoundary {
  readonly scope: "LOCAL_QA" | "CANONICAL_CI";
  readonly repository: string;
  readonly projectId: string;
  readonly apiPort: number;
  readonly dbPort: number;
  readonly migrationSources: 202;
  readonly runtimeSources: 33;
  readonly evidenceSources: 334;
  readonly manifestSha256: string;
  readonly previousManifestSha256: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly nativeHashes: Readonly<Record<string, string>>;
  readonly browserConsumerHashes: Readonly<Record<string, string>>;
  readonly migrationVersions: readonly string[];
}
export function assertBackend202CanonicalSources(
  root?: string,
): Backend202SourceBoundary;
export function assertBackend202LocalSources(
  root?: string,
): Backend202SourceBoundary;

export function assertBackend202Origin(
  origin: string,
  env?: Readonly<Record<string, string | undefined>>,
): void;

export const BACKEND202_PREDECESSOR_SHA256: string;
export const BACKEND202_APPROVED_ADDITIONS: Readonly<Record<string, string>>;
export function assertBackend202ManifestShape(
  manifest: unknown,
): Readonly<{ state: "SHAPE_VALIDATED_NOT_SOURCE_ADMITTED" }>;
