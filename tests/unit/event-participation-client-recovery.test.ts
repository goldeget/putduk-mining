// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { EventParticipation } from "@/components/product/event-participation";

const eventId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const participantId = "33333333-3333-4333-8333-333333333333";
const outboxId = "44444444-4444-4444-8444-444444444444";
const receipt = {
  eventId,
  revisionId,
  participantId,
  outboxId,
  status: "JOINED",
  joinedAt: "2026-10-20T00:00:00Z",
  completedAt: null,
  rewardedAt: null,
  replayed: true,
};
let host: HTMLDivElement, root: Root;
const transport = vi.fn<typeof fetch>();
const render = (canJoin: boolean, joined = false) =>
  act(async () => {
    root.render(
      createElement(EventParticipation, {
        eventId,
        revisionId,
        canJoin,
        joined,
      }),
    );
  });
const button = () => host.querySelector("button")!;
const click = () => act(async () => button().click());

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  vi.stubGlobal("fetch", transport);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("member event participation client recovery", () => {
  it("keeps new participation disabled outside the event window", async () => {
    await render(false);
    expect(button().disabled).toBe(true);
    await click();
    expect(transport).not.toHaveBeenCalled();
  });

  it("can confirm a lost response with the original request after the window ends", async () => {
    transport.mockRejectedValueOnce(new TypeError("response lost"));
    await render(true);
    await click();
    expect(button().textContent).toBe("참여 결과 다시 확인");
    const firstBody = JSON.parse(String(transport.mock.calls[0]![1]!.body));
    expect(firstBody).toEqual({
      eventId,
      revisionId,
      idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });

    // Next refresh merges fresh server props while preserving this client state.
    await render(false);
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("참여 결과 다시 확인");
    transport.mockResolvedValueOnce(Response.json({ data: receipt }));
    await click();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(transport.mock.calls[1]![1]!.body))).toEqual(
      firstBody,
    );
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("참여 중");
    expect(host.textContent).toContain("참여가 기록됐어요");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("uses a refreshed owned participation instead of offering another join", async () => {
    await render(true);
    expect(button().disabled).toBe(false);
    await render(true, true);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("참여 중");
    await click();
    expect(transport).not.toHaveBeenCalled();
  });

  it("stops an uncertain retry when the server denies a new join after closing", async () => {
    transport.mockRejectedValueOnce(new TypeError("response lost"));
    await render(true);
    await click();
    const firstBody = String(transport.mock.calls[0]![1]!.body);
    await render(false);
    transport.mockResolvedValueOnce(
      Response.json(
        { error: { code: "EVENT_NOT_AVAILABLE" } },
        { status: 409 },
      ),
    );
    await click();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(String(transport.mock.calls[1]![1]!.body)).toBe(firstBody);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("참여 기간이 아니에요");
    expect(host.textContent).toContain("참여 조건이나 기간이 바뀌었어요");
    await click();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });
});
