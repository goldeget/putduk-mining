import { describe, expect, it, vi } from "vitest";
import {
  handleWorkroomCommand,
  handleWorkroomRead,
} from "@/lib/workroom/handler";

const origin = "https://mining.putduk.com";
function dependencies(authenticated = true) {
  return {
    origin,
    authorize: vi.fn(async () =>
      authenticated ? { userId: "member-one" } : null,
    ),
    read: vi.fn(async () => ({ data: { member: null }, error: null })),
    command: vi.fn(async () => ({
      data: { member: { balance: 100000 } },
      error: null,
    })),
  };
}
function request(body: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1/workroom/command", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "idempotency-key": "workroom-test-key",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
describe("WORKROOM member API authority", () => {
  it("denies anonymous state reads before the RPC", async () => {
    const d = dependencies(false);
    const r = await handleWorkroomRead(d);
    expect(r.status).toBe(401);
    expect(d.read).not.toHaveBeenCalled();
  });
  it("does not mutate or open accounts in a state GET", async () => {
    const d = dependencies();
    expect((await handleWorkroomRead(d)).status).toBe(200);
    expect(d.command).not.toHaveBeenCalled();
    expect(d.read).toHaveBeenCalledOnce();
  });
  it("rejects hostile origin before authorization or mutation", async () => {
    const d = dependencies();
    const r = await handleWorkroomCommand(
      request(
        { operation: "OPEN", input: {} },
        { origin: "https://evil.example" },
      ),
      d,
    );
    expect(r.status).toBe(403);
    expect(d.authorize).not.toHaveBeenCalled();
    expect(d.command).not.toHaveBeenCalled();
  });
  it("requires a stable idempotency key", async () => {
    const d = dependencies();
    const r = await handleWorkroomCommand(
      request({ operation: "OPEN", input: {} }, { "idempotency-key": "" }),
      d,
    );
    expect(r.status).toBe(400);
    expect(d.command).not.toHaveBeenCalled();
  });
  it("rejects client beneficiary, ROI and fractional stake overrides", async () => {
    for (const input of [
      {
        instrument: "nvda",
        stake: 1000,
        acknowledged: true,
        expectedVersion: 1,
        userId: "other",
      },
      {
        instrument: "nvda",
        stake: 1000,
        acknowledged: true,
        expectedVersion: 1,
        roi: 50,
      },
      {
        instrument: "nvda",
        stake: 1000.1,
        acknowledged: true,
        expectedVersion: 1,
      },
    ]) {
      const d = dependencies();
      expect(
        (await handleWorkroomCommand(request({ operation: "START", input }), d))
          .status,
      ).toBe(400);
      expect(d.command).not.toHaveBeenCalled();
    }
  });
  it("passes only validated input and original key", async () => {
    const d = dependencies();
    const r = await handleWorkroomCommand(
      request({
        operation: "START",
        input: {
          instrument: "nvda",
          stake: 1000,
          acknowledged: true,
          expectedVersion: 1,
        },
      }),
      d,
    );
    expect(r.status).toBe(200);
    expect(d.command).toHaveBeenCalledWith(
      { userId: "member-one" },
      "START",
      "workroom-test-key",
      {
        instrument: "nvda",
        stake: 1000,
        acknowledged: true,
        expectedVersion: 1,
      },
    );
  });
  it("bounds the request and hides internal SQL errors", async () => {
    const d = dependencies();
    expect(
      (
        await handleWorkroomCommand(
          request({ operation: "OPEN", input: { padding: "x".repeat(17000) } }),
          d,
        )
      ).status,
    ).toBe(413);
    d.command.mockResolvedValueOnce({
      data: null,
      error: { message: "secret SQL connection detail" },
    } as never);
    const r = await handleWorkroomCommand(
      request({ operation: "OPEN", input: {} }),
      d,
    );
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
  it("returns retry conflicts without converting failure to success", async () => {
    const d = dependencies();
    d.command.mockResolvedValueOnce({
      data: null,
      error: { message: "WORKROOM_REQUEST_CONFLICT" },
    } as never);
    const r = await handleWorkroomCommand(
      request({ operation: "OPEN", input: {} }),
      d,
    );
    expect(r.status).toBe(409);
  });
});
