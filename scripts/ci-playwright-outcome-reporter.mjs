import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function relativeFile(rootDir, file) {
  return path.relative(rootDir, file).split(path.sep).join("/");
}

/**
 * Execution evidence without attachment or stdio bodies.
 * The built-in JSON reporter base64-encodes those bodies and can exceed
 * Node's maximum string length after screenshot-heavy files pass.
 */
class OutcomeReporter {
  constructor() {
    this.outputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    this.errors = [];
  }

  version() {
    return "v2";
  }

  printsToStdio() {
    return false;
  }

  onConfigure(config) {
    this.config = config;
  }

  onBegin(suite) {
    this.suite = suite;
  }

  onError(error) {
    this.errors.push({ message: String(error?.message ?? "error") });
  }

  onEnd(result) {
    if (!this.outputFile)
      throw new Error("Missing PLAYWRIGHT_JSON_OUTPUT_FILE");
    const rootDir = this.config.rootDir;
    const stats = {
      startTime: result.startTime.toISOString(),
      duration: result.duration,
      expected: 0,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    };
    const suites = [];
    for (const projectSuite of this.suite.suites) {
      const projectName = projectSuite.project().name;
      for (const fileSuite of projectSuite.suites) {
        const specs = [];
        const visit = (suite) => {
          for (const test of suite.tests) {
            const outcome = test.outcome();
            stats[outcome] += 1;
            specs.push({
              title: test.title,
              ok: test.ok(),
              tags: test.tags.map((tag) => tag.substring(1)),
              id: test.id,
              file: relativeFile(rootDir, test.location.file),
              line: test.location.line,
              column: test.location.column,
              tests: [
                {
                  timeout: test.timeout,
                  annotations: [],
                  expectedStatus: test.expectedStatus,
                  projectName,
                  status: outcome,
                  results: test.results.map((item) => ({
                    status: item.status,
                    duration: item.duration,
                    retry: item.retry,
                  })),
                },
              ],
            });
          }
          for (const child of suite.suites) visit(child);
        };
        visit(fileSuite);
        if (!specs.length) continue;
        suites.push({
          title: fileSuite.title,
          file: relativeFile(rootDir, fileSuite.location.file),
          column: 0,
          line: 0,
          specs,
        });
      }
    }
    mkdirSync(path.dirname(this.outputFile), { recursive: true });
    writeFileSync(
      this.outputFile,
      JSON.stringify({
        config: { configFile: this.config.configFile, rootDir },
        suites,
        errors: this.errors,
        stats,
      }),
    );
  }
}

export default OutcomeReporter;
