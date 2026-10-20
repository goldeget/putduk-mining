export interface Catalog202Proof {
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
export const EMPTY202: readonly string[];
export const REQUIRED_COLUMNS202: Readonly<
  Record<string, Readonly<Record<string, string>>>
>;
export const CATALOG202_QUERIES: readonly { label: string; sql: string }[];
export function assertBackend202CatalogProof(
  proof: Catalog202Proof,
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
export function readBackend202FreshCatalog(
  query: (sql: string) => {
    status: number | null;
    stdout: string;
    stderr: string;
  },
  versions: readonly string[],
  containerId: string,
): Catalog202Proof;
