export function parseUsdt195RunnerArguments(args: readonly string[]): Readonly<{containerId: string; output: string}>;
export function assertUsdt195Tap(stdout: string, exitCode: number, expectedCount: 80 | 388): Readonly<{
  assertions: number; plan: string; skipped: 0; tapSha256: string;
}>;
export type Usdt195ConcurrencyContract = Readonly<{
  local: readonly string[]; canonical: readonly string[]; requiredSuccessKeys: readonly string[];
  fixture_origin: string; fixture_sha256: string;
}>;
export function assertUsdt195Concurrency(stdout: string, exitCode: number,
  scope: "LOCAL_QA" | "CANONICAL_CI", contract: Usdt195ConcurrencyContract): Readonly<{
    assertions: number; names: readonly string[]; run: string; fixturePreludeSha256: string; skipped: 0;
  }>;
