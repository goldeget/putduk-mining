// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeRewardAction } from "@/components/product/welcome-reward-action";
import {
  readWelcomeConversionRejection,
  welcomeKycRequiredCopy,
} from "@/lib/product/welcome-conversion-response";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => createElement("a", { href, ...props }, children),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(conversion?: { id: string; status: string }) {
  await act(async () =>
    root.render(
      createElement(WelcomeRewardAction, { conversion: conversion ?? null }),
    ),
  );
}
const identityLinks = () =>
  Array.from(host.querySelectorAll<HTMLAnchorElement>("a")).filter(
    (link) => link.getAttribute("href") === "/menu/account",
  );

describe("welcome reward identity step is reachable", () => {
  it("uses the same 본인 확인 wording as the account page", () => {
    expect(welcomeKycRequiredCopy).toContain("본인 확인");
    expect(welcomeKycRequiredCopy).not.toContain("실명 확인");
    expect(
      readWelcomeConversionRejection(409, {
        error: {
          code: "WELCOME_REWARD_KYC_REQUIRED",
          message: "ignored server text",
        },
      }),
    ).toBe(welcomeKycRequiredCopy);
  });

  it("a 409 KYC-required rejection shows the message and a link to 본인 확인", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "WELCOME_REWARD_KYC_REQUIRED",
            message: "서버 문구는 표시하지 않아요",
          },
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(identityLinks()).toHaveLength(0);
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(host.textContent).toContain(welcomeKycRequiredCopy);
    expect(identityLinks()).toHaveLength(1);
    expect(identityLinks()[0]?.textContent).toContain("본인 확인");
    // The conversion command stays retryable and no withdrawal link appears.
    expect(host.textContent).toContain("환영 보상 자격 확인하기");
    expect(host.querySelector('a[href^="/wallet/withdraw"]')).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["RISK_REVIEW", "TRIAL_NOT_COMPLETED"])(
    "other business rejections (%s) do not send the member to identity",
    async (name) => {
      const code =
        name === "RISK_REVIEW"
          ? "WELCOME_REWARD_RISK_REVIEW_REQUIRED"
          : "TRIAL_NOT_COMPLETED";
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ error: { code, message: "서버 문구" } }),
              { status: 409 },
            ),
          ),
      );
      await mount();
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button")!.click(),
      );
      expect(identityLinks()).toHaveLength(0);
    },
  );

  it("a PENDING_QUALIFICATION conversion offers the identity step instead of a dead end", async () => {
    await mount({
      id: "d092731d-ca0e-4976-8de4-88a5034a429a",
      status: "PENDING_QUALIFICATION",
    });
    expect(host.textContent).toContain("자격 확인 중");
    expect(identityLinks()).toHaveLength(1);
  });

  it.each(["QUALIFIED", "AUTO_HOLD", "APPROVED"])(
    "%s shows no identity link (nothing for the member to do)",
    async (status) => {
      await mount({ id: "d092731d-ca0e-4976-8de4-88a5034a429a", status });
      expect(identityLinks()).toHaveLength(0);
    },
  );
});
