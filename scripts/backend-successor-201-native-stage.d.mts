export interface Native201Derivative {
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
export function adaptBackend201NativeInput3(
  source: Buffer | string,
  basis: Buffer | string,
): Native201Derivative;
export function adaptBackend201DefinerRoster(
  name: string,
  source: Buffer | string,
): Native201Derivative;
export function adaptBackend201ServiceRoleInsertFloor(
  source: Buffer | string,
): Native201Derivative;
