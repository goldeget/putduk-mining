export function createBrandFixtureReader(root: string): {
  read(file: string, encoding?: "utf8"): Promise<Buffer | string>;
};
export function readBrandFixtureFile(file: string): Promise<Buffer>;
export function readBrandFixtureFile(
  file: string,
  encoding: "utf8",
): Promise<string>;
export function primeBrandFixtureReads(): Promise<void>;
