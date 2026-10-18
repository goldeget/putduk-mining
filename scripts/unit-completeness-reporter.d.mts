import type {
  Reporter,
  TestModule,
  TestSpecification,
  Vitest,
} from "vitest/node";
export function unitRunCompleteness(
  specifications: ReadonlyArray<
    Pick<TestSpecification, "moduleId" | "project">
  >,
  modules: ReadonlyArray<Pick<TestModule, "moduleId" | "project">>,
): {
  complete: boolean;
  expectedFiles: number;
  reportedFiles: number;
  missing: string[];
  unexpected: string[];
  duplicateAdmissions: string[];
  duplicateModules: string[];
};
export function jsonUnitCompleteness(
  receipt: {
    complete: boolean;
    modules?: Array<{
      moduleId: string;
      tests: number;
      passed: number;
      failed: number;
      skipped: number;
      assertions?: Array<{ identity: string; state: string }>;
    }>;
  },
  report: {
    testResults?: Array<{
      name: string;
      assertionResults?: Array<{
        status: string;
        title?: string;
        ancestorTitles?: string[];
      }>;
    }>;
    numTotalTests?: number;
    numPassedTests?: number;
    numFailedTests?: number;
    numPendingTests?: number;
    numTodoTests?: number;
  },
): {
  complete: boolean;
  issues: string[];
  files: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
};
export default class UnitCompletenessReporter implements Reporter {
  onInit(context: Vitest): void;
  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void;
  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    errors: ReadonlyArray<unknown>,
    reason: "passed" | "interrupted" | "failed",
  ): void;
}
