export const BACKEND202_PLAYWRIGHT_OUTPUT_DIRS: readonly string[];
export function backend202HttpPaths(
  root: string,
  outputDirs?: readonly string[],
): Readonly<{
  reportOutput: string;
  evidenceOutput: string;
  report: string;
  intent: string;
  proof: string;
}>;
