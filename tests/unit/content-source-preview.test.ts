import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  CONTENT_SOURCE_PINS,
  CONTENT_SOURCE_REVISION,
  ContentSourcePreviewError,
  extractContentSourceProposal,
  previewPinnedContentSource,
} from "@/domain/content/source-preview";
import {
  contentReceiptSchema,
  eventContentSchema,
} from "@/domain/content/contract";
import {
  CONTENT_SOURCE_PREVIEW_MAX_BODY_BYTES,
  createContentSourcePreviewHandler,
} from "../../apps/admin/lib/content/source-preview-handler";

const id = "10000000-0000-4000-8000-000000000001";
const session = "10000000-0000-4000-8000-000000000002";
const rawFixtureDirectory = process.env.PUTDUK_CONTENT_SOURCE_FIXTURE_DIR;
const authorize = vi.fn();
const forbidden = {
  rpc: vi.fn(),
  provider: vi.fn(),
  grant: vi.fn(),
};
const dependencies = { authorize, ...forbidden };
const handler = createContentSourcePreviewHandler(dependencies);
const pin = CONTENT_SOURCE_PINS.find((entry) => entry.path === "events.json")!;
const invalidRawInput = {
  sourceRevision: CONTENT_SOURCE_REVISION,
  sourcePath: pin.path,
  sourceSha256: pin.sha256,
  rawSourceText: "unverified-original",
};
function request(
  body: unknown = invalidRawInput,
  headers: Record<string, string> = {},
) {
  return new Request(
    "https://admin.example.invalid/api/content/source/preview",
    {
      method: "POST",
      headers: {
        Origin: "https://admin.example.invalid",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}
function record(
  metadata: Record<string, unknown> = {},
  storage: Record<string, unknown> = {},
) {
  return {
    slug: "original-guide-id",
    storage: {
      slug: "original-storage-target",
      title_ko: "이용 안내",
      summary_ko: "이용 방법을 확인해 주세요.",
      status: "DRAFT",
      starts_at: null,
      ends_at: null,
      published_at: null,
      ...storage,
    },
    metadata: {
      audience: "MEMBERS",
      category: "event",
      cta: { label: "안내 보기", route: "/home" },
      approval: { required: true, status: "PENDING", approved_by: null },
      economy: {
        impact: "NONE",
        policy_status: "NOT_APPLICABLE",
        values: {},
      },
      variables: [],
      source_baseline: "a".repeat(40),
      publication_gate: "REVIEW_REQUIRED",
      card_title_ko: "필요한 안내",
      body_markdown: "화면에서 이용 방법을 확인해 주세요.",
      segment: "ALL_MEMBERS",
      participation: "안내를 읽습니다. 보상 청구를 만들지 않습니다.",
      exclusion: "다른 사람의 계정을 이용하지 않습니다.",
      registration_kind: "INFORMATIONAL_CAMPAIGN_PROPOSAL",
      ...metadata,
    },
  };
}
function exactRawInput(path: string) {
  const sourcePin = CONTENT_SOURCE_PINS.find((entry) => entry.path === path)!;
  return {
    sourceRevision: CONTENT_SOURCE_REVISION,
    sourcePath: path,
    sourceSha256: sourcePin.sha256,
    rawSourceText: readFileSync(join(rawFixtureDirectory!, path), "utf8"),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    ok: true,
    principal: {
      userId: id,
      adminSessionId: session,
      sessionId: session,
      aal: "aal2",
      role: "ADMIN",
    },
  });
});

describe("read-only original content extraction", () => {
  it("pins all 13 immutable files without mixing the later delta revision", () => {
    expect(CONTENT_SOURCE_PINS).toHaveLength(13);
    expect(Object.isFrozen(CONTENT_SOURCE_PINS)).toBe(true);
    expect(CONTENT_SOURCE_PINS.every(Object.isFrozen)).toBe(true);
    expect(
      CONTENT_SOURCE_PINS.filter((entry) => entry.kind !== "REFERENCE"),
    ).toMatchObject([
      { path: "events.json", itemCount: 30 },
      { path: "notices.json", itemCount: 26 },
      { path: "faq.json", itemCount: 68 },
    ]);
  });
  it("preserves IDs, target, pending approval, DRAFT and original metadata", () => {
    const original = record();
    const before = JSON.stringify(original);
    const result = extractContentSourceProposal("EVENT", original);
    expect(result.original).toEqual(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(result).toMatchObject({
      originalId: "original-guide-id",
      originalTarget: "original-storage-target",
      originalState: "DRAFT",
      canExecute: false,
      canPublish: false,
      candidate: {
        kind: "EVENT",
        content: {
          participationMode: "GUIDE",
          rewardMode: "NONE",
          startsAt: null,
          endsAt: null,
        },
      },
    });
    expect(result.blockedReasons).toEqual([
      "ORIGINAL_DRAFT_ONLY",
      "OPERATOR_APPROVAL_PENDING",
      "SCHEDULE_UNAPPROVED",
      "GUIDE_NOT_REWARD_MISSION",
    ]);
  });
  it.each([
    "NEW_MEMBERS",
    "MINING_MEMBERS",
    "DEPOSIT_MEMBERS",
    "WITHDRAWAL_MEMBERS",
  ])("does not flatten the original %s target into ALL_MEMBERS", (segment) => {
    const result = extractContentSourceProposal("EVENT", record({ segment }));
    expect(result.original.metadata.segment).toBe(segment);
    expect(result.candidate).toBeNull();
    expect(result.blockedReasons).toContain("TARGET_SEGMENT_UNSUPPORTED");
  });
  it("does not replace a policy-dependent original with NONE or guessed values", () => {
    const economy = {
      impact: "POLICY_DEPENDENT",
      policy_status: "POLICY_VALUE_REQUIRED",
      values: {},
      policy_version: null,
      budget_approval: null,
    };
    const result = extractContentSourceProposal("EVENT", record({ economy }));
    expect(result.original.metadata.economy).toEqual(economy);
    expect(result.candidate).toBeNull();
    expect(result.blockedReasons).toContain("POLICY_APPROVAL_PENDING");
  });
  it("retains template variables and blocks rather than resolving them", () => {
    const result = extractContentSourceProposal(
      "NOTICE",
      record(
        { template: true, variables: ["confirmed_facts"] },
        {
          body_markdown: "{{confirmed_facts}}",
          is_pinned: false,
          expires_at: null,
        },
      ),
    );
    expect(result.original.metadata.variables).toEqual(["confirmed_facts"]);
    expect(result.candidate).toMatchObject({
      kind: "NOTICE",
      content: { body: "{{confirmed_facts}}" },
    });
    expect(result.blockedReasons).toContain("TEMPLATE_UNRESOLVED");
    expect(result.canPublish).toBe(false);
  });
  it("does not convert member FAQ to PUBLIC or invent a storage target", () => {
    const original = {
      ...record({ category: "account" }),
      storage: {},
      title_ko: "어디서 확인하나요?",
      body_ko: "본인 계정의 화면에서 확인해 주세요.",
    };
    const result = extractContentSourceProposal("FAQ", original);
    expect(result.originalTarget).toBeNull();
    expect(result.originalState).toBeNull();
    expect(result.candidate).toMatchObject({
      kind: "FAQ",
      content: { audience: "MEMBERS" },
    });
    expect(result.blockedReasons).toEqual([
      "ORIGINAL_DRAFT_ONLY",
      "OPERATOR_APPROVAL_PENDING",
      "FAQ_MEMBER_AUDIENCE_REQUIRES_PRIVATE_REVIEW",
      "FAQ_AGGREGATE_REVIEW_REQUIRED",
    ]);
  });
  it.each([
    { sourcePath: "../events.json" },
    { sourcePath: "unknown.json" },
    { sourceRevision: "3".repeat(40) },
  ])("fails closed on unknown pin %j", (change) => {
    expect(() =>
      previewPinnedContentSource({ ...invalidRawInput, ...change }),
    ).toThrowError(new ContentSourcePreviewError("SOURCE_PIN_UNKNOWN"));
  });
  it.each([
    { sourceSha256: "0".repeat(64) },
    { rawSourceText: "unverified-approved-content" },
  ])("does not accept caller pin/hash authority %j", (change) => {
    expect(() =>
      previewPinnedContentSource({ ...invalidRawInput, ...change }),
    ).toThrowError(new ContentSourcePreviewError("SOURCE_HASH_MISMATCH"));
  });
  it("keeps legacy absent participation mode absent, with compatible receipt", () => {
    const candidate = extractContentSourceProposal(
      "EVENT",
      record(),
    ).candidate!;
    if (candidate.kind !== "EVENT") throw new Error("EXPECTED_EVENT");
    const legacy = { ...candidate.content };
    delete legacy.participationMode;
    const parsed = eventContentSchema.parse(legacy);
    expect(Object.hasOwn(parsed, "participationMode")).toBe(false);
    expect(
      contentReceiptSchema.safeParse({
        contentKind: "EVENT",
        contentId: id,
        revisionId: session,
        revision: 1,
        state: "DRAFT",
        digest: "a".repeat(64),
        snapshot: parsed,
        auditId: id,
        outboxId: session,
      }).success,
    ).toBe(true);
    expect(
      eventContentSchema.safeParse({
        ...parsed,
        participationMode: "JOIN",
      }).success,
    ).toBe(true);
    expect(
      eventContentSchema.safeParse({
        ...parsed,
        participationMode: "AUTO_REWARD",
      }).success,
    ).toBe(false);
  });
});

describe("admin source preview HTTP boundary", () => {
  it.each([
    { status: 401, code: "UNAUTHENTICATED" },
    { status: 403, code: "ORIGIN_DENIED" },
    { status: 403, code: "MFA_REQUIRED" },
    { status: 403, code: "ADMIN_SESSION_EXPIRED" },
  ])("authorizes before reading the body (%s)", async (denial) => {
    authorize.mockResolvedValue({ ok: false, ...denial });
    const input = request();
    const response = await handler(input);
    expect(response.status).toBe(denial.status);
    expect(input.bodyUsed).toBe(false);
    expect(authorize.mock.calls[0]![0]).toBe(input);
    expect(authorize.mock.calls[0]![1]).toEqual(["SUPER_ADMIN", "ADMIN"]);
    Object.values(forbidden).forEach((port) =>
      expect(port).not.toHaveBeenCalled(),
    );
  });
  it.each([
    { role: "CONTENT_ADMIN" },
    { role: "SUPPORT_ADMIN" },
    { role: "VIEWER" },
    { aal: "aal1" },
    { adminSessionId: "unverified-session" },
    { sessionId: "" },
  ])("rechecks a malformed successful principal %j", async (change) => {
    authorize.mockResolvedValue({
      ok: true,
      principal: {
        userId: id,
        adminSessionId: session,
        sessionId: session,
        aal: "aal2",
        role: "ADMIN",
        ...change,
      },
    });
    const input = request();
    expect((await handler(input)).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
  });
  it("does not expose authorization exceptions, raw body or deployment origin", async () => {
    authorize.mockRejectedValue(new Error("private_auth_secret"));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(
      /private_auth|example\.invalid|unverified-original/,
    );
  });
  it("rejects caller command/grant/provider fields rather than using them", async () => {
    const response = await handler(
      request({
        ...invalidRawInput,
        command: "manage_liveops_content",
        grant: "untrusted-proof",
        provider: "real-provider",
        actor: id,
      }),
    );
    expect(response.status).toBe(400);
    Object.values(forbidden).forEach((port) =>
      expect(port).not.toHaveBeenCalled(),
    );
  });
  it("keeps the hash mismatch response private without echoing raw source", async () => {
    const response = await handler(request());
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie, Origin");
    expect(await response.json()).toEqual({
      error: {
        code: "SOURCE_HASH_MISMATCH",
        message: "고정된 원본과 내용이 같은지 확인해 주세요.",
      },
    });
  });
  it("rejects oversized declared bodies at the file-based bound", async () => {
    const response = await handler(
      request(invalidRawInput, {
        "Content-Length": String(CONTENT_SOURCE_PREVIEW_MAX_BODY_BYTES + 1),
      }),
    );
    expect(response.status).toBe(413);
    Object.values(forbidden).forEach((port) =>
      expect(port).not.toHaveBeenCalled(),
    );
  });
  it("bounds actual chunked bytes even with misleading Content-Length", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify(invalidRawInput) +
        " ".repeat(CONTENT_SOURCE_PREVIEW_MAX_BODY_BYTES),
    );
    const input = new Request(
      "https://admin.example.invalid/api/content/source/preview",
      {
        method: "POST",
        headers: {
          Origin: "https://admin.example.invalid",
          "Content-Type": "application/json",
          "Content-Length": "1",
        },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        ...({ duplex: "half" } satisfies { duplex: "half" }),
      },
    );
    expect((await handler(input)).status).toBe(413);
  });
});

// Originals stay outside product source. This opt-in reads exact pinned bytes.
describe.skipIf(!rawFixtureDirectory)("fixed original source fixtures", () => {
  it.each(CONTENT_SOURCE_PINS)(
    "verifies exact original bytes and Git blob for $path",
    (sourcePin) => {
      const input = exactRawInput(sourcePin.path);
      const preview = previewPinnedContentSource(input);
      expect(preview.source.sha256).toBe(sourcePin.sha256);
      expect(preview.items).toHaveLength(sourcePin.itemCount);
      expect(preview).toMatchObject({
        generationMode: "SOURCE_EXTRACTIVE",
        state: "DRAFT_ONLY",
        canPublish: false,
        canExecute: false,
        providerCalled: false,
        registrationExecuted: false,
      });
    },
  );
  it("preserves 30 events, including 10 targets and 2 unapproved policies", () => {
    const input = exactRawInput("events.json");
    const original = JSON.parse(input.rawSourceText);
    const preview = previewPinnedContentSource(input);
    expect(preview.items.map((item) => item.original)).toEqual(original);
    expect(preview.guideProposalCount).toBe(20);
    expect(preview.rewardMissionCount).toBe(0);
    expect(
      preview.items.filter((item) =>
        item.blockedReasons.includes("TARGET_SEGMENT_UNSUPPORTED"),
      ),
    ).toHaveLength(10);
    expect(
      preview.items.filter((item) =>
        item.blockedReasons.includes("POLICY_APPROVAL_PENDING"),
      ),
    ).toHaveLength(2);
    expect(preview.items.every((item) => item.originalState === "DRAFT")).toBe(
      true,
    );
  });
  it("preserves 26 notices and all 8 unresolved templates", () => {
    const preview = previewPinnedContentSource(exactRawInput("notices.json"));
    expect(preview.items).toHaveLength(26);
    expect(
      preview.items.filter((item) =>
        item.blockedReasons.includes("TEMPLATE_UNRESOLVED"),
      ),
    ).toHaveLength(8);
  });
  it("keeps all 68 FAQ proposals member-scoped without publication", () => {
    const preview = previewPinnedContentSource(exactRawInput("faq.json"));
    expect(preview.items).toHaveLength(68);
    expect(
      preview.items.every(
        (item) =>
          item.original.metadata.audience === "MEMBERS" &&
          item.candidate?.kind === "FAQ" &&
          item.candidate.content.audience === "MEMBERS" &&
          item.blockedReasons.includes("FAQ_AGGREGATE_REVIEW_REQUIRED"),
      ),
    ).toBe(true);
  });
  it("accepts the real 106KB event file with the bounded HTTP wrapper", async () => {
    const response = await handler(request(exactRawInput("events.json")));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.items).toHaveLength(30);
    expect(payload.data.guideProposalCount).toBe(20);
    Object.values(forbidden).forEach((port) =>
      expect(port).not.toHaveBeenCalled(),
    );
  });
  it("fails closed when approved state, newline or source hash is changed", () => {
    const input = exactRawInput("events.json");
    for (const changed of [
      {
        ...input,
        rawSourceText: input.rawSourceText.replace("DRAFT", "PUBLISHED"),
      },
      { ...input, rawSourceText: input.rawSourceText.replace(/\n/g, "\r\n") },
      { ...input, sourceSha256: "0".repeat(64) },
    ])
      expect(() => previewPinnedContentSource(changed)).toThrowError(
        new ContentSourcePreviewError("SOURCE_HASH_MISMATCH"),
      );
  });
});
