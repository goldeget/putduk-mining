import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("worker runtime evidence seam", () => {
  it("keeps claim entrypoints available for the isolated worker job", () => {
    const source = readFileSync("workers/runner.mjs", "utf8");
    expect(source).toContain("claim_outbox_events");
    expect(source).toContain("claim_system_jobs");
    expect(source).toContain("Browser is not the runner");
    expect(source).not.toContain("queues.send");
  });
});
