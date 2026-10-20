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
export function primeHistoricalRecoveryFixtureSources(
  root: string,
  paths: Iterable<string>,
  generation: number,
): void;
export function verifyHistoricalRecoveryBytes(
  path: string,
  bytes: Buffer,
  generation: number,
): true;
export function readHistoricalBrowserTransportSource(
  root: string,
  path: string,
): Buffer;
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
  prepare(): Promise<void>;
  settle(): Promise<void>;
  root(mode: "canonical" | "local"): string;
};
export function prepareHistorical195UnitFixtures(
  root: string,
  scratch: string,
  prefix: string,
  roots: string[],
): {
  prepare(name: string): Promise<void>;
  settle(): Promise<void>;
  root(mode: "canonical" | "local"): string;
};

export function readHistoricalNativeProvenance(path: string): Buffer;

export function stageHistoricalRecoveryGuardSource(
  source: string,
  name: string,
): string;

export function verifyPreparedHistoricalFixture(
  root: string,
  entries: Iterable<readonly [string, Uint8Array | string]>,
  prefix: string,
): void;
export function verifyPreparedHistoricalFixtureConcurrently(
  root: string,
  entries: Iterable<readonly [string, Uint8Array | string]>,
  prefix: string,
): Promise<void>;
export function createHistoricalFixturePreparation(): {
  run<T>(build: () => Promise<T>, publish: (value: T) => void): Promise<void>;
  settle(): Promise<void>;
};
