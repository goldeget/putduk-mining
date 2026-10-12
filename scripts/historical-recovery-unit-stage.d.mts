export function readHistoricalRecoverySource(
  root: string,
  path: string,
  generation: number,
): Buffer;
export function readHistoricalRecoveryFixtureSource(
  root: string,
  path: string,
  generation: number,
): Buffer;
export function verifyHistoricalRecoveryBytes(
  path: string,
  bytes: Buffer,
  generation: number,
): true;
export function stageHistoricalRecoveryTestSource(
  source: string,
  name: string,
): string;
export function historicalRecoveryUnitPlugin(): {
  name: string;
  enforce: "pre";
  transform(code: string, id: string): { code: string; map: null } | undefined;
};
export function prepareBackend197UnitFixtures(
  root: string,
  scratch: string,
  prefix: string,
  roots: string[],
): {
  prepare(): void;
  root(mode: "canonical" | "local"): string;
};
export function prepareHistorical195UnitFixtures(
  root: string,
  scratch: string,
  prefix: string,
  roots: string[],
): {
  prepare(name: string): void;
  root(mode: "canonical" | "local"): string;
};
