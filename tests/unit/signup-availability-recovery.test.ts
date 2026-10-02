/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "@/app/signup/signup-form";
import { checkSignupPhoneAvailability } from "@/app/signup/actions";

vi.mock("@/app/signup/actions", () => ({
  signupAction: vi.fn(),
  checkSignupPhoneAvailability: vi.fn(),
}));

describe("signup availability read recovery", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(SignupForm)));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });
  function field(id: string) {
    const input = host.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) throw new Error(`Missing field ${id}`);
    return input;
  }
  function button(id: string) {
    const button = field(id).parentElement?.querySelector("button");
    if (!button) throw new Error(`Missing check button ${id}`);
    return button;
  }
  async function enter(id: string, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(field(id), value);
      field(id).dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function check(id: string) {
    await act(async () => button(id).click());
    expect(button(id).disabled).toBe(true);
  }
  async function expire() {
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
  }

  it("releases a stalled ID request without losing the typed ID", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    await enter("signup-login-id", "fixture_user");
    await check("signup-login-id");
    await expire();
    expect(signal?.aborted).toBe(true);
    expect(button("signup-login-id").disabled).toBe(false);
    expect(field("signup-login-id").value).toBe("fixture_user");
    expect(host.querySelector("#login-id-status")?.textContent).toContain(
      "못했어요",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an ID JSON-body stall within the same request deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }),
    );
    await enter("signup-login-id", "fixture_user");
    await check("signup-login-id");
    await expire();
    expect(button("signup-login-id").disabled).toBe(false);
    expect(host.querySelector("#login-id-status")?.textContent).toContain(
      "못했어요",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late phone availability reply after timeout and after typing another number", async () => {
    let resolveFirst: ((value: "AVAILABLE") => void) | undefined;
    vi.mocked(checkSignupPhoneAvailability).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await enter("signup-phone", "01012345678");
    await check("signup-phone");
    await expire();
    expect(button("signup-phone").disabled).toBe(false);
    expect(host.querySelector("#phone-status")?.textContent).toContain(
      "못했어요",
    );
    await enter("signup-phone", "01087654321");
    await act(async () => resolveFirst?.("AVAILABLE"));
    expect(field("signup-phone").value).toBe("01087654321");
    expect(host.querySelector("#phone-status")?.textContent).not.toContain(
      "사용할 수 있는 번호",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts ID reads and clears read timers when the signup form unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    await enter("signup-login-id", "fixture_user");
    await check("signup-login-id");
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
