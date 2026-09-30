/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeWithdrawalAction } from "@/components/product/welcome-withdrawal-action";
import {
  MEMBER_WELCOME_WITHDRAWAL_FALLBACK,
  MEMBER_WITHDRAWAL_NETWORK_FALLBACK,
} from "@/components/product/member-withdrawal-errors";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const RAW_RELATION = "relation withdrawal_requests does not exist";
const RAW_SERVICE_ROLE = "service_role";
const RAW_SCHEMA_CACHE = "schema cache error";

const destinations = [
  {
    displayHint: "국민 ****1234",
    id: "dest-welcome",
    method: "KRW_BANK" as const,
    policyId: "policy-welcome",
  },
];

function assertRawCopyAbsent(text: string) {
  expect(text).not.toContain(RAW_RELATION);
  expect(text).not.toContain("withdrawal_requests");
  expect(text).not.toContain(RAW_SERVICE_ROLE);
  expect(text).not.toContain(RAW_SCHEMA_CACHE);
  expect(text).not.toContain("schema cache");
}

async function renderAction() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(WelcomeWithdrawalAction, {
        conversionId: "conversion-welcome",
        destinations,
        requested: false,
      }) as ReactNode,
    );
  });
  return { host, root };
}

async function submit(host: HTMLElement) {
  const button = host.querySelector("button");
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    throw new Error("첫 출금 버튼이 준비되지 않았습니다.");
  }
  await act(async () => {
    button.click();
  });
}

function feedback(host: HTMLElement) {
  return host.querySelector('[role="status"]')?.textContent ?? "";
}

describe("환영 출금 회원 오류 표시", () => {
  let root: Root | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = undefined;
    }
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("주입된 DB·역할·스키마 원문을 화면에 그리지 않고 기본 안내를 쓴다", async () => {
    const payloads = [
      {
        error: {
          code: "POSTGREST_RELATION_MISSING",
          message: RAW_RELATION,
        },
      },
      {
        error: {
          code: "INTERNAL_ROLE_LEAK",
          message: `permission denied for ${RAW_SERVICE_ROLE}`,
        },
      },
      {
        error: {
          message: RAW_SCHEMA_CACHE,
        },
      },
      {
        message: `${RAW_RELATION} ${RAW_SERVICE_ROLE} ${RAW_SCHEMA_CACHE}`,
      },
    ];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => payloads[call++] ?? null,
      })),
    );

    const rendered = await renderAction();
    root = rendered.root;

    for (let index = 0; index < payloads.length; index += 1) {
      await submit(rendered.host);
      const text = feedback(rendered.host);
      expect(text).toBe(MEMBER_WELCOME_WITHDRAWAL_FALLBACK);
      assertRawCopyAbsent(text);
      assertRawCopyAbsent(rendered.host.textContent ?? "");
    }

    expect(call).toBe(payloads.length);
  });

  it("허용된 코드는 정해진 한국어만 보여주고 동행한 원문은 버린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          error: {
            code: "WELCOME_REWARD_WITHDRAWAL_EXISTS",
            message: `${RAW_RELATION}; ${RAW_SERVICE_ROLE}; ${RAW_SCHEMA_CACHE}`,
          },
        }),
      })),
    );

    const rendered = await renderAction();
    root = rendered.root;
    await submit(rendered.host);

    const text = feedback(rendered.host);
    expect(text).toBe("이미 접수된 환영 보상 출금이 있습니다.");
    assertRawCopyAbsent(text);
    assertRawCopyAbsent(rendered.host.textContent ?? "");
  });

  it("응답 본문 파싱 실패와 네트워크 예외도 원문을 노출하지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => {
          throw new Error(
            `${RAW_RELATION} ${RAW_SERVICE_ROLE} ${RAW_SCHEMA_CACHE}`,
          );
        },
      })),
    );

    const parsed = await renderAction();
    root = parsed.root;
    await submit(parsed.host);
    expect(feedback(parsed.host)).toBe(MEMBER_WELCOME_WITHDRAWAL_FALLBACK);
    assertRawCopyAbsent(parsed.host.textContent ?? "");

    act(() => {
      root?.unmount();
    });
    root = undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          `${RAW_RELATION} ${RAW_SERVICE_ROLE} ${RAW_SCHEMA_CACHE}`,
        );
      }),
    );

    const thrown = await renderAction();
    root = thrown.root;
    await submit(thrown.host);
    const text = feedback(thrown.host);
    expect(text).toBe(MEMBER_WITHDRAWAL_NETWORK_FALLBACK);
    assertRawCopyAbsent(text);
    assertRawCopyAbsent(thrown.host.textContent ?? "");
  });
});
