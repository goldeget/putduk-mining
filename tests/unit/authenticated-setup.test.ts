import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureOperatorActor = vi.hoisted(() => vi.fn());
vi.mock("../e2e/authenticated/helpers/eligibility", () => ({
  ensureOperatorActor,
}));

import setupAuthenticatedFixtures from "../e2e/fixtures/authenticated-setup";

beforeEach(() => {
  ensureOperatorActor.mockReset();
});

describe("authenticated local fixture bootstrap", () => {
  it("uses the existing local operator helper exactly once", async () => {
    ensureOperatorActor.mockResolvedValue({ userId: "local-operator" });
    await expect(setupAuthenticatedFixtures()).resolves.toBeUndefined();
    expect(ensureOperatorActor).toHaveBeenCalledTimes(1);
    expect(ensureOperatorActor).toHaveBeenCalledWith();
  });

  it("waits for initialization before allowing tests to start", async () => {
    let release: (() => void) | undefined;
    ensureOperatorActor.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    let completed = false;
    const setup = setupAuthenticatedFixtures().then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(release).toBeTypeOf("function");
    release?.();
    await setup;
    expect(completed).toBe(true);
  });

  it("does not swallow local-target or bootstrap failures", async () => {
    const failure = new Error("LOCAL_TARGET_OR_BOOTSTRAP_FAILED");
    ensureOperatorActor.mockRejectedValue(failure);
    await expect(setupAuthenticatedFixtures()).rejects.toBe(failure);
    expect(ensureOperatorActor).toHaveBeenCalledTimes(1);
  });
});
