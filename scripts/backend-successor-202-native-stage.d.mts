export interface Native202Derivative {
  sql: string;
  sha256: string;
  originalSha256: string;
  changes: {
    name: string;
    matches: number;
    beforeSha256: string;
    afterSha256: string;
  }[];
  reverseExact: boolean;
}
export function adaptBackend202NativeInput3(
  source: Buffer | string,
  basis: Buffer | string,
): Native202Derivative;
export function adaptBackend202DefinerRoster(
  name: string,
  source: Buffer | string,
): Native202Derivative;
export function adaptBackend202ServiceRoleInsertFloor(
  source: Buffer | string,
): Native202Derivative;

export const BACKEND202_NATIVE_SOURCE_ROOTS: readonly [
  "supabase/migrations",
  "supabase/tests",
  "supabase/test-fixtures",
  "supabase/tests-concurrent",
];
