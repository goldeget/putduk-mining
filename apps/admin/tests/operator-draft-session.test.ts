// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changed: null as
    ((event: string, session: { user: { id: string } } | null) => void) | null,
  observe: vi.fn(),
  unsubscribe: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createAdminBrowserClient: (config: unknown) => {
    mocks.createClient(config);
    return {
      auth: {
        onAuthStateChange: (callback: typeof mocks.changed) => {
          mocks.changed = callback;
          return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
        },
      },
    };
  },
}));

import {
  OperatorDraftProvider,
  useOperatorDraft,
} from "@/components/assistant/operator-draft-provider";
import { usableOperatorDraft } from "@/lib/assistant/draft";

let root: Root;
let container: HTMLDivElement;
type Access = ReturnType<typeof useOperatorDraft>;
const owner = "0d470000-0000-4000-8000-000000000001";
const publicConfig = {
  url: "http://127.0.0.1:54321",
  publishableKey: "local-public-key-for-runtime-test",
};

function candidate() {
  return {
    task: "usdt-deposit-draft",
    command: "confirm_usdt_manual_deposit",
    input: {
      depositId: "0d470000-0000-4000-8000-000000000002",
      creditedKrw: "50000",
      reason: "운영 도우미 초안만 확인하는 시험입니다.",
    },
    targetCreatedAt: "2026-08-01T00:00:00+00:00",
    preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    href: "/deposits/usdt",
    canExecute: false,
  };
}
function Probe() {
  const value = useOperatorDraft();
  useEffect(() => {
    mocks.observe(value);
  }, [value]);
  return createElement("output", null, value.draft?.input.reason ?? "no draft");
}
async function render(userId = owner, session = "first") {
  await act(async () =>
    root.render(
      createElement(
        OperatorDraftProvider,
        { userId, publicConfig, key: `${userId}:${session}` },
        createElement(Probe),
      ),
    ),
  );
}
function access(): Access {
  return mocks.observe.mock.lastCall![0] as Access;
}
async function save(value: unknown = candidate()) {
  let accepted = false;
  await act(async () => {
    const current = access();
    accepted = current.save(value, current.ticket());
  });
  return accepted;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T06:00:00Z"));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("operator draft session and expiry", () => {
  it("subscribes with the server runtime public configuration", async () => {
    await render();
    expect(mocks.createClient).toHaveBeenCalledWith(publicConfig);
    expect(access().clearedReason).toBeNull();
    expect(await save()).toBe(true);
  });
  it("rejects drafts when the auth subscription cannot be created", async () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error("subscription unavailable");
    });
    await render();
    await act(async () => vi.runAllTicks());
    expect(access().clearedReason).toBe("SESSION");
    expect(await save()).toBe(false);
  });
  it("keeps only a valid draft in the current provider memory", async () => {
    await render();
    expect(await save()).toBe(true);
    expect(container.textContent).toContain("운영 도우미 초안만 확인");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it("expires the draft and rejects a late response using the old request ticket", async () => {
    await render();
    const value = candidate();
    const old = access();
    const ticket = old.ticket();
    expect(await save(value)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_001);
    });
    expect(access().draft).toBeNull();
    expect(access().clearedReason).toBe("EXPIRED");
    expect(access().save(value, ticket)).toBe(false);
  });
  it.each(["offline", "pagehide"])(
    "clears memory and invalidates old responses on %s",
    async (event) => {
      await render();
      await save();
      const old = access();
      const ticket = old.ticket();
      await act(async () => window.dispatchEvent(new Event(event)));
      expect(access().draft).toBeNull();
      expect(access().save(candidate(), ticket)).toBe(false);
    },
  );
  it.each(["SIGNED_OUT", "USER_UPDATED"])(
    "blocks further saves on authority change %s",
    async (event) => {
      await render();
      await save();
      await act(async () => mocks.changed?.(event, null));
      expect(access().draft).toBeNull();
      expect(access().clearedReason).toBe("SESSION");
      expect(await save()).toBe(false);
    },
  );
  it("clears a different signed-in owner before a server rebind", async () => {
    await render();
    await save();
    await act(async () =>
      mocks.changed?.("SIGNED_IN", { user: { id: "another" } }),
    );
    expect(access().draft).toBeNull();
    expect(await save()).toBe(false);
  });
  it("remounts empty for a new admin session and rejects old-session callbacks", async () => {
    await render();
    await save();
    const old = access();
    const ticket = old.ticket();
    await render(owner, "second");
    expect(access().draft).toBeNull();
    expect(old.save(candidate(), ticket)).toBe(false);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(await save()).toBe(true);
  });
  it.each([
    { canExecute: true },
    { command: "execute" },
    { confirmation: "CONFIRM_USDT_DEPOSIT" },
    { stepUpToken: "token" },
    { expiresAt: "2026-10-03T07:00:00Z" },
    { preparedAt: "2026-10-03T06:05:00Z", expiresAt: "2026-10-03T06:10:00Z" },
  ])(
    "rejects mutated authority and lifetime without storing a draft",
    async (mutation) => {
      await render();
      expect(await save({ ...candidate(), ...mutation })).toBe(false);
      expect(access().draft).toBeNull();
    },
  );
  it("rejects a draft at the exact expiry boundary", () => {
    const value = candidate();
    expect(
      usableOperatorDraft(value, Date.parse(value.expiresAt) - 1),
    ).not.toBeNull();
    expect(usableOperatorDraft(value, Date.parse(value.expiresAt))).toBeNull();
  });
});
