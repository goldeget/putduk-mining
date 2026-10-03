// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EconomyConsole } from "@/app/(control)/economy/economy-console";
import { OperatorDraftProvider } from "@/components/assistant/operator-draft-provider";
import { StepUpTokenField } from "@/components/step-up-token-field";
import type { EconomyConsoleView, EconomySettings } from "@/lib/economy/types";
import approvedFixture from "../../../docs/product/economy-v1-approved-2026-10-03.json";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  listeners: new Set<(event: string) => void>(),
  unsubscribe: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => {
    mocks.createClient(...args);
    return {
      auth: {
        onAuthStateChange(callback: (event: string) => void) {
          mocks.listeners.add(callback);
          return {
            data: {
              subscription: {
                unsubscribe() {
                  mocks.listeners.delete(callback);
                  mocks.unsubscribe();
                },
              },
            },
          };
        },
      },
    };
  },
}));

const publicConfig = {
  url: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
  publishableKey: "sb_publishable_test_runtime_configuration",
};
const source = approvedFixture as EconomySettings & {
  policyVersion: string;
  approvalEvidence: string;
};
const view: EconomyConsoleView = {
  schemaVersion: 1,
  serverNow: "2026-10-03T10:00:00Z",
  selectedVersion: {
    policyId: "00000000-0000-4000-8000-000000000001",
    policyVersion: source.policyVersion,
    configDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    approvalEvidence: source.approvalEvidence,
    approvalEvidenceDigest: "c".repeat(64),
    createdAt: "2026-10-03T10:00:00Z",
    settings: source,
    latestRevision: {
      revisionId: "00000000-0000-4000-8000-000000000002",
      revision: 4,
      state: "PUBLISHED",
      effectiveFrom: "2026-10-03T10:00:00Z",
      predecessorPublicationId: null,
      publishedAt: "2026-10-03T10:00:00Z",
    },
    history: [],
  },
  referenceSettings: source,
  versions: [],
  latestPublishedStart: "2026-10-03T10:00:00Z",
  runtimeStatus: "POLICY_CONSUMER_NOT_ENABLED",
};
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function button(label: string) {
  return [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  )!;
}
async function renderConsole() {
  await act(async () =>
    root.render(
      createElement(
        OperatorDraftProvider,
        { userId: "operator-current", publicConfig },
        createElement(EconomyConsole, {
          initial: view,
          publicConfig: {
            ...publicConfig,
            publishableKey: "stale-build-public-key",
          },
        }),
      ),
    ),
  );
  await act(async () => button("새 버전 작성").click());
}

describe("economy control runtime public configuration", () => {
  it("uses the provider tuple for policy and step-up observers with absent build-time public values", async () => {
    await renderConsole();
    expect(mocks.createClient).toHaveBeenCalledTimes(3);
    for (const [url, key] of mocks.createClient.mock.calls) {
      expect(url).toBe(publicConfig.url);
      expect(key).toBe(publicConfig.publishableKey);
    }
    expect(button("입력 접기").disabled).toBe(false);
    expect(host.textContent).not.toContain("로그인 정보가 바뀌었습니다");
    expect(
      host
        .querySelector('input[name="policyVersion"]')
        ?.getAttribute("pattern"),
    ).toBe("[A-Z][A-Z0-9._\\-]{2,99}");
  });
  it.each(["SIGNED_OUT", "USER_UPDATED"])(
    "clears the issued proof and stops policy operations on %s",
    async (event) => {
      await renderConsole();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: { verified: true } })),
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                data: {
                  token: "runtime-single-use-proof-token",
                  commandFamily: "ECONOMY_POLICY",
                },
              }),
            ),
          ),
      );
      const code = host.querySelector<HTMLInputElement>(
        'input[autocomplete="one-time-code"]',
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(code, "123456");
        code.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => button("작업 확인").click());
      const token = host.querySelector<HTMLInputElement>(
        'input[name="stepUpToken"]',
      )!;
      expect(token.value).toBe("runtime-single-use-proof-token");
      await act(async () => {
        for (const listener of [...mocks.listeners]) listener(event);
      });
      expect(token.value).toBe("");
      expect(button("입력 접기").disabled).toBe(true);
      expect(host.textContent).toContain("로그인 정보가 바뀌었습니다");
      await act(async () => root.unmount());
      expect(mocks.listeners.size).toBe(0);
      expect(mocks.unsubscribe).toHaveBeenCalledTimes(3);
    },
  );
  it("keeps the standalone auth-screen fallback when no control provider is mounted", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", publicConfig.url);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      publicConfig.publishableKey,
    );
    await act(async () =>
      root.render(
        createElement(StepUpTokenField, {
          commandFamily: "ECONOMY_POLICY",
        }),
      ),
    );
    expect(mocks.createClient).toHaveBeenCalledWith(
      publicConfig.url,
      publicConfig.publishableKey,
      expect.any(Object),
    );
    expect(mocks.listeners.size).toBe(1);
  });
});
