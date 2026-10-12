export interface Concurrency197Derivative {
  sql: string;
  sha256: string;
  changes: {
    name: string;
    matches: number;
    beforeSha256: string;
    afterSha256: string;
  }[];
  scopedChanges: {
    name: string;
    matches: number;
    beforeSha256: string;
    afterSha256: string;
  }[];
}
export function bindBackend197Concurrency(
  derivative: { sql: string; sha256: string; changes: unknown[] },
  scope: "LOCAL_QA" | "CANONICAL_CI",
  profile: Record<string, unknown> | null,
  containerId: string,
): Concurrency197Derivative;
