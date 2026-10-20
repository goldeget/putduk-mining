// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("server-only", () => ({}));
const identity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: identity }));
vi.mock("@/lib/env/public", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:61441" }),
}));
import { EventParticipation } from "@/components/product/event-participation";
import { handleMemberEventParticipation } from "@/lib/events/participation-handler.server";

const eventId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const terms = {
  event_id: eventId,
  content_revision_id: revisionId,
  terms_version: 1,
  terms_ko: "실제 정산과 공개된 조건을 충족한 경우에만 지급됩니다.",
  cash_terms_digest: "a".repeat(64),
  reward_krw: "1000",
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-11-01T00:00:00Z",
};
const receipt = {
  eventId,
  revisionId,
  participantId: "33333333-3333-4333-8333-333333333333",
  outboxId: "44444444-4444-4444-8444-444444444444",
  status: "JOINED",
  joinedAt: "2026-10-20T00:00:00Z",
  completedAt: null,
  rewardedAt: null,
  replayed: false,
  cashTermsDigest: terms.cash_terms_digest,
  cashTermsVersion: 1,
  cashConsentRecorded: true,
  scope: "LOCAL_QA",
};
let host: HTMLDivElement, root: Root;
const transport = vi.fn<typeof fetch>();
const render = (cashTerms = terms, canJoin = true, joined = false) =>
  act(async () => {
    root.render(
      createElement(EventParticipation, {
        eventId,
        revisionId,
        canJoin,
        joined,
        cashTerms,
      }),
    );
  });
const button = () => host.querySelector("button")!;
const agree = () =>
  act(async () =>
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
const submit = () => act(async () => button().click());
beforeEach(() => {
  vi.clearAllMocks();
  transport.mockReset();
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
describe("published cash terms explicit member consent", () => {
  it("requires fresh consent and intent after a definite authentication denial", async () => {
    await render();
    await agree();
    transport.mockResolvedValueOnce(
      Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
    );
    await submit();
    expect(button().disabled).toBe(true);
    const first = JSON.parse(String(transport.mock.calls[0]![1]!.body));
    await render({
      ...terms,
      cash_terms_digest: "b".repeat(64),
      terms_version: 2,
    });
    await agree();
    transport.mockResolvedValueOnce(
      Response.json({
        data: {
          ...receipt,
          cashTermsDigest: "b".repeat(64),
          cashTermsVersion: 2,
        },
      }),
    );
    await submit();
    const second = JSON.parse(String(transport.mock.calls[1]![1]!.body));
    expect(second.cashTermsDigest).toBe("b".repeat(64));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(host.textContent).toContain("참여가 기록됐어요");
  });
  it("uses a new consent intent after a confirmed join when published terms change", async () => {
    await render();
    await agree();
    transport.mockResolvedValueOnce(Response.json({ data: receipt }));
    await submit();
    const first = JSON.parse(String(transport.mock.calls[0]![1]!.body));
    await render({
      ...terms,
      cash_terms_digest: "b".repeat(64),
      terms_version: 2,
    });
    expect(button().disabled).toBe(true);
    await agree();
    transport.mockResolvedValueOnce(
      Response.json({
        data: {
          ...receipt,
          cashTermsDigest: "b".repeat(64),
          cashTermsVersion: 2,
          replayed: true,
        },
      }),
    );
    await submit();
    const second = JSON.parse(String(transport.mock.calls[1]![1]!.body));
    expect(second.cashTermsDigest).toBe("b".repeat(64));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(host.textContent).toContain("참여가 기록됐어요");
  });
  it("runs the real client→HTTP handler→authenticated RPC/readback adapter without a financial command", async () => {
    const userId = "55555555-5555-4555-8555-555555555555";
    const rpc = vi.fn(async () => ({ data: receipt, error: null }));
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({
        data: {
          id: receipt.participantId,
          event_id: eventId,
          user_id: userId,
          status: "JOINED",
          joined_at: receipt.joinedAt,
        },
        error: null,
      }),
    };
    identity.mockResolvedValue({
      userId,
      supabase: { rpc, from: () => query },
    });
    transport.mockImplementation(async (_url, init) =>
      handleMemberEventParticipation(
        new Request("http://127.0.0.1:61441/api/v1/events/participation", {
          ...init,
          headers: {
            "Content-Type": "application/json",
            origin: "http://127.0.0.1:61441",
          },
        }),
      ),
    );
    await render();
    await agree();
    await submit();
    expect(host.textContent).toContain("참여가 기록됐어요");
    expect(button().disabled).toBe(true);
    expect(rpc).toHaveBeenCalledWith("participate_published_event", {
      p_event_id: eventId,
      p_revision_id: revisionId,
      p_idempotency_key: expect.any(String),
      p_request_id: expect.any(String),
      p_cash_terms_digest: "a".repeat(64),
    });
  });
  it("shows server terms and amount, requires an unchecked explicit acknowledgement", async () => {
    await render();
    expect(host.textContent).toContain(terms.terms_ko);
    expect(host.textContent).toContain("1,000원");
    expect(button().disabled).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    ).toBe(false);
    await submit();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "acknowledges exact terms for joined=%s without sending money or ownership claims",
    async (joined) => {
      await render(terms, true, joined);
      await agree();
      transport.mockResolvedValueOnce(Response.json({ data: receipt }));
      await submit();
      expect(JSON.parse(String(transport.mock.calls[0]![1]!.body))).toEqual({
        eventId,
        revisionId,
        idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
        cashTermsDigest: "a".repeat(64),
      });
      expect(button().disabled).toBe(true);
      expect(host.textContent).toContain("참여가 기록됐어요");
    },
  );
  it("requires a fresh acknowledgement if displayed terms change before submission", async () => {
    await render();
    await agree();
    expect(button().disabled).toBe(false);
    await render({
      ...terms,
      cash_terms_digest: "b".repeat(64),
      terms_version: 2,
    });
    expect(button().disabled).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    ).toBe(false);
    await submit();
    expect(transport).not.toHaveBeenCalled();
  });
  it("retains original terms, digest and UUID when a response is lost even after refreshed terms/window", async () => {
    await render();
    await agree();
    transport.mockRejectedValueOnce(new TypeError("lost"));
    await submit();
    const first = String(transport.mock.calls[0]![1]!.body);
    await render(
      {
        ...terms,
        cash_terms_digest: "b".repeat(64),
        terms_version: 2,
        terms_ko: "변경된 약관",
      },
      false,
    );
    expect(host.textContent).toContain(terms.terms_ko);
    expect(host.textContent).not.toContain("변경된 약관");
    expect(button().disabled).toBe(false);
    transport.mockResolvedValueOnce(
      Response.json({ data: { ...receipt, replayed: true } }),
    );
    await submit();
    expect(String(transport.mock.calls[1]![1]!.body)).toBe(first);
    expect(host.textContent).toContain("참여가 기록됐어요");
  });
  it.each([
    { cashConsentRecorded: false },
    { cashTermsDigest: "b".repeat(64) },
    { cashTermsVersion: 2 },
    { scope: "PRODUCTION" },
    { privateBudget: 1000 },
  ])(
    "does not claim success for a mismatched positive receipt %j",
    async (patch) => {
      await render();
      await agree();
      transport.mockResolvedValueOnce(
        Response.json({ data: { ...receipt, ...patch } }),
      );
      await submit();
      expect(host.textContent).toContain("참여 결과를 확인하지 못했어요");
      expect(host.textContent).not.toContain("참여가 기록됐어요");
      expect(button().textContent).toBe("참여 결과 다시 확인");
    },
  );
});
