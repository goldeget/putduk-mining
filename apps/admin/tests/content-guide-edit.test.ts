// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentConsole } from "@/app/(control)/content/content-console";
import type { ContentReceipt } from "../../../domain/content/contract";

// Keep authentication outside this form serialization regression. The real
// field obtains a server token; this fixture supplies only its callback result.
vi.mock("@/components/step-up-token-field", () => ({
  StepUpTokenField: ({
    onTokenIssued,
  }: {
    onTokenIssued: (token: string) => void;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        onClick: () => onTokenIssued("fixture-reviewed-content-token"),
      },
      "작업 확인 준비",
    ),
}));

const contentId = "10000000-0000-4000-8000-000000000001";
const revisionId = "10000000-0000-4000-8000-000000000002";
const baseSnapshot = {
  slug: "member-guide",
  title: "회원 안내",
  cardTitle: "새로운 안내",
  summary: "필요한 안내를 확인해 주세요.",
  body: "참여 방법과 기간을 확인해 주세요.",
  ctaLabel: "이벤트 보기",
  ctaRoute: "/events",
  audience: "MEMBERS",
  segment: "ALL_MEMBERS",
  rewardMode: "NONE",
  participation: "안내된 내용을 확인합니다.",
  exclusion: "취소된 안내는 확인할 수 없습니다.",
  startsAt: "2026-10-20T00:00:00Z",
  endsAt: "2026-10-21T00:00:00Z",
};
let host: HTMLDivElement;
let root: Root;
let item: ContentReceipt;
let submitted: Record<string, unknown>[];

function button(label: string) {
  const found = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function field(name: string) {
  const found = host.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(`[name="${name}"]`);
  if (!found) throw new Error(`Missing field: ${name}`);
  return found;
}

async function confirmAndSubmit(label: string) {
  field("reason").value = "회원이 이해하기 쉽도록 안내 문구를 수정합니다.";
  (field("confirmation") as HTMLInputElement).checked = true;
  await act(async () => button("작업 확인 준비").click());
  await act(async () => button(label).click());
  expect(submitted).toHaveLength(1);
  return submitted[0]!;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  submitted = [];
  item = {
    contentKind: "EVENT",
    contentId,
    revisionId,
    revision: 1,
    state: "DRAFT",
    digest: "a".repeat(64),
    snapshot: baseSnapshot,
    auditId: "10000000-0000-4000-8000-000000000003",
    outboxId: "10000000-0000-4000-8000-000000000004",
  };
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    if (path === "/api/content/state")
      return Response.json({ data: { items: [item] } });
    if (path !== "/api/content/command")
      throw new Error("Unexpected request outside content fixture");
    submitted.push(JSON.parse(String(init.body)));
    // Serialization is the tested boundary, not a synthetic publication success.
    return Response.json(
      { error: { message: "연결을 다시 확인해 주세요." } },
      { status: 503 },
    );
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("event draft participation mode at the admin request boundary", () => {
  it.each(["GUIDE", "JOIN", undefined] as const)(
    "preserves %s when only draft wording changes",
    async (mode) => {
      item.snapshot = {
        ...baseSnapshot,
        ...(mode === undefined ? {} : { participationMode: mode }),
      };
      await act(async () => root.render(createElement(ContentConsole)));
      await act(async () => button("안내 불러오기").click());
      const saved = host.querySelector<HTMLButtonElement>(
        'section[aria-label="등록한 안내"] button',
      );
      expect(saved).not.toBeNull();
      await act(async () => saved!.click());
      field("title").value = "수정한 회원 안내";

      const command = await confirmAndSubmit("수정 저장");
      expect(command).toMatchObject({
        operation: "UPDATE_DRAFT",
        kind: "EVENT",
        contentId,
        expectedRevision: revisionId,
        expectedDigest: "a".repeat(64),
        payload: { title: "수정한 회원 안내", rewardMode: "NONE" },
      });
      const payload = command.payload as Record<string, unknown>;
      if (mode === undefined)
        expect(payload).not.toHaveProperty("participationMode");
      else expect(payload.participationMode).toBe(mode);
    },
  );

  it("keeps a new draft on the existing legacy JOIN default", async () => {
    await act(async () => root.render(createElement(ContentConsole)));
    for (const name of [
      "slug",
      "title",
      "cardTitle",
      "summary",
      "body",
      "ctaLabel",
      "ctaRoute",
      "participation",
      "exclusion",
    ] as const)
      field(name).value = baseSnapshot[name];
    const command = await confirmAndSubmit("초안 저장");
    expect(command).toMatchObject({
      operation: "CREATE_DRAFT",
      contentId: null,
      expectedRevision: null,
      payload: { rewardMode: "NONE" },
    });
    expect(command.payload).not.toHaveProperty("participationMode");
  });
});
