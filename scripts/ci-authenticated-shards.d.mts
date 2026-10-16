export interface AuthenticatedTestEvidence {
  key: string;
  project: string;
  file: string;
  expectedStatus: unknown;
  status: unknown;
  results: { status: unknown; duration: unknown; retry: unknown }[];
}
export function inventoryFromReport(
  report: unknown,
  cwd?: string,
): AuthenticatedTestEvidence[];
export function assertSameInventory(
  expected: readonly AuthenticatedTestEvidence[],
  actual: readonly AuthenticatedTestEvidence[],
): void;
export function assertAuthenticatedExecution(
  report: unknown,
  expected: readonly AuthenticatedTestEvidence[],
  cwd?: string,
): AuthenticatedTestEvidence[];
export function balanceInventory(
  inventory: readonly AuthenticatedTestEvidence[],
  total?: number,
): unknown[];
export function testListFor(
  shard: unknown,
  rootDir: string,
  cwd?: string,
): string;
