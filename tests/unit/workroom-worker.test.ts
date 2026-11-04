import { describe, expect, it, vi } from "vitest";
import { runWorkerCycle, processJobBatch } from "../../workers/runner.mjs";
describe("replacement worker never starts legacy earning", () => {
  it("does not schedule funding and claims only operational jobs", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await runWorkerCycle({ rpc } as never);
    expect(
      rpc.mock.calls.some(
        (call) => (call as unknown[])[0] === "schedule_due_funding_jobs",
      ),
    ).toBe(false);
    const claim = rpc.mock.calls.find(
      (call) => (call as unknown[])[0] === "claim_system_jobs",
    ) as unknown[] | undefined;
    expect(claim?.[1]).toMatchObject({ p_allow_funding: false });
  });
  it("cannot reenable funding through an old worker option", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await processJobBatch({ rpc } as never, { allowFundingJobs: true });
    expect((rpc.mock.calls[0] as unknown[])[1]).toMatchObject({
      p_allow_funding: false,
    });
  });
});
