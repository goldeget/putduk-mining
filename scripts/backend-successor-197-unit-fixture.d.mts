export function stageBackend197UnitFixtureSource(source: string): string;
export function backend197UnitConfigPair(
  source: string,
): Readonly<{ local: string; canonical: string }>;
export function backend197UnitFixturePlugin(): {
  name: string;
  enforce: "pre";
  transform(code: string, id: string): { code: string; map: null } | undefined;
};
export function prepareBackend197UnitFixtures(
  repository: string,
  scratch: string,
  prefix: string,
  roots: string[],
): { prepare(): void; root(mode: "canonical" | "local"): string };
