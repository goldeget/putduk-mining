export interface Native197Derivative {
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
export function adaptBackend197NativeInput3(
  source: Buffer | string,
  basis: Buffer | string,
): Native197Derivative;
export function adaptBackend197DefinerRoster(
  name: string,
  source: Buffer | string,
): Native197Derivative;
export function adaptBackend197ServiceRoleInsertFloor(
  source: Buffer | string,
): Native197Derivative;
