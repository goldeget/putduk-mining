import { describe, expect, it, vi } from "vitest";
import { createSessionActivity } from "@/lib/auth/session-activity";
function setup() {
  let clock = 0,
    visible = true;
  const send = vi.fn(async () => {});
  const tracker = createSessionActivity({
    send,
    isVisible: () => visible,
    now: () => clock,
  });
  return {
    send,
    tracker,
    advance: (n: number) => {
      clock += n;
    },
    hide: () => {
      visible = false;
    },
  };
}
describe("foreground activity heartbeat", () => {
  it("keeps a busy page alive while throttling to one request per minute", async () => {
    const x = setup();
    x.advance(60000);
    x.tracker.recordActivity();
    await x.tracker.tick();
    expect(x.send).toHaveBeenCalledTimes(1);
    await x.tracker.tick();
    expect(x.send).toHaveBeenCalledTimes(1);
    x.advance(60000);
    x.tracker.recordActivity();
    await x.tracker.tick();
    expect(x.send).toHaveBeenCalledTimes(2);
  });
  it("does not keep a forgotten tab alive", async () => {
    const x = setup();
    x.advance(120000);
    await x.tracker.tick();
    expect(x.send).not.toHaveBeenCalled();
  });
  it("does not refresh hidden tabs even with recent activity", async () => {
    const x = setup();
    x.advance(60000);
    x.tracker.recordActivity();
    x.hide();
    await x.tracker.tick();
    expect(x.send).not.toHaveBeenCalled();
  });
  it("recovers after network failure without logging out or making a retry storm", async () => {
    const x = setup();
    x.send.mockRejectedValueOnce(new Error("offline"));
    x.advance(60000);
    x.tracker.recordActivity();
    await expect(x.tracker.tick()).resolves.toBeUndefined();
    await x.tracker.tick();
    expect(x.send).toHaveBeenCalledTimes(1);
    x.advance(60000);
    x.tracker.recordActivity();
    await x.tracker.tick();
    expect(x.send).toHaveBeenCalledTimes(2);
  });
  it("stops heartbeats when the layout unmounts", async () => {
    const x = setup();
    x.tracker.stop();
    x.advance(60000);
    x.tracker.recordActivity();
    await x.tracker.tick();
    expect(x.send).not.toHaveBeenCalled();
  });
});
