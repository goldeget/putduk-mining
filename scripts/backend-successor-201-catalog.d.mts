export interface Catalog201Proof {
  state: string;
  containerId: string;
  startedAt: number;
  finishedAt: number;
  metadata: unknown;
  migrationVersions: readonly string[];
  expectedMigrationVersions: readonly string[];
  counts: Readonly<Record<string, number>>;
  absentTables: readonly string[];
  missingOrWrongTypeColumns: Readonly<Record<string, unknown>>;
  existingProtectedTablesEmpty: boolean;
  schemaAndCatalogReady: boolean;
  rawProcesses: readonly unknown[];
}
export const EMPTY201: readonly string[];
export const REQUIRED_COLUMNS201: Readonly<
  Record<string, Readonly<Record<string, string>>>
>;
export const CATALOG201_QUERIES: readonly { label: string; sql: string }[];
export function assertBackend201CatalogProof(
  proof: Catalog201Proof,
  versions: readonly string[],
  containerId: string,
  window?: { startedAt: number; observedAt: number },
): Readonly<{
  state: string;
  containerId: string;
  rawProcesses: number;
  migrations: number;
  emptyTables: number;
}>;
export function readBackend201FreshCatalog(
  query: (sql: string) => {
    status: number | null;
    stdout: string;
    stderr: string;
  },
  versions: readonly string[],
  containerId: string,
): Catalog201Proof;
