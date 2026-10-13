/** Guard evidence is outside every source-reviewed Playwright test output tree. */
import { resolve, relative, isAbsolute, sep } from "node:path";
export const BACKEND201_PLAYWRIGHT_OUTPUT_DIRS = Object.freeze([
  "test-results",
  "test-results/backend-browser-197",
  "test-results/backend-browser-201",
  "test-results/backend-http-193-browser",
  "test-results/backend-http-195-api",
  "test-results/backend-http-197-api",
  "test-results/backend-http-201-api",
  "test-results/review-r2-browser",
  "test-results/typography",
  "test-results/typography-protected",
  "test-results/ui-readiness",
]);
function ancestor(a, b) {
  const rel = relative(a, b);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
}
export function backend201HttpPaths(
  root,
  outputDirs = BACKEND201_PLAYWRIGHT_OUTPUT_DIRS,
) {
  const base = resolve(root),
    reportOutput = resolve(base, "test-results/backend-http-201-api"),
    evidenceOutput = resolve(
      base,
      "playwright-report/backend201-http-evidence",
    );
  for (const entry of outputDirs) {
    if (
      typeof entry !== "string" ||
      isAbsolute(entry) ||
      entry.includes("\\") ||
      entry.includes(":") ||
      entry.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw Error("BACKEND201_PLAYWRIGHT_OUTPUT_SCOPE_REJECTED");
    const out = resolve(base, entry);
    if (ancestor(out, evidenceOutput) || ancestor(evidenceOutput, out))
      throw Error("BACKEND201_HTTP_EVIDENCE_OUTPUT_OVERLAP");
  }
  return Object.freeze({
    reportOutput,
    evidenceOutput,
    report: resolve(reportOutput, "report.json"),
    intent: resolve(evidenceOutput, "execution-intent.json"),
    proof: resolve(evidenceOutput, "current-proof.json"),
  });
}
