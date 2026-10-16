import { describe, expect, it } from "vitest";
import {
  contentCommandSchema,
  contentReceiptSchema,
  CONTENT_PAYLOAD_SCHEMAS,
  hasValidContentWindow,
  isSafeContentCopy,
} from "../../domain/content/contract";
import {
  faqContentSchema,
  FAQ_MAX_SERIALIZED_BYTES,
  isBoundedFaqPayload,
  memberFaqSchema,
  ORIGINAL_FAQ_SOURCE_DIGEST,
} from "../../domain/content/faq";

const id = "20000000-0000-4000-8000-000000000001";
const payload = {
  slug: "member-faq",
  title: "회원 자주 묻는 질문",
  summary: "앱 이용에 필요한 안내를 확인해 주세요.",
  audience: "MEMBERS",
  segment: "ALL_MEMBERS",
  locale: "ko-KR",
  entries: [
    {
      stableEntryId: "mining-progress",
      question: "앱을 닫아도 채굴이 계속되나요?",
      answer: "앱을 닫아도 채굴은 계속돼요.",
    },
  ],
  sourceDigest: ORIGINAL_FAQ_SOURCE_DIGEST,
  publishedAt: null,
  expiresAt: null,
};
const command = {
  kind: "FAQ",
  operation: "CREATE_DRAFT",
  contentId: null,
  expectedRevision: null,
  expectedDigest: null,
  payload,
  reason: "회원에게 필요한 질문과 답변을 검토합니다.",
  stepUpToken: "verified-step-up-token",
  confirmation: "CONFIRM_LIVEOPS_CONTENT",
};
const receipt = {
  contentKind: "FAQ",
  contentId: id,
  revisionId: id,
  revision: 1,
  state: "DRAFT",
  digest: "a".repeat(64),
  snapshot: payload,
  auditId: id,
  outboxId: id,
};

describe("closed member FAQ CMS contract", () => {
  it("dispatches FAQ explicitly and accepts only member-faq original source pin", () => {
    expect(Object.keys(CONTENT_PAYLOAD_SCHEMAS)).toEqual([
      "EVENT",
      "NOTICE",
      "FAQ",
    ]);
    expect(faqContentSchema.parse(payload)).toEqual(payload);
    expect(contentCommandSchema.safeParse(command).success).toBe(true);
    expect(contentReceiptSchema.safeParse(receipt).success).toBe(true);
  });
  it.each([
    { slug: "privacy" },
    { slug: "about" },
    { audience: "PUBLIC" },
    { segment: "NEW_MEMBERS" },
    { locale: "en-US" },
    { sourceDigest: "a".repeat(64) },
    { ctaRoute: "/wallet" },
    { rewardMode: "NONE" },
    { visibility: "AUTHENTICATED" },
    { title: " " },
    { title: "가".repeat(141) },
    { summary: "가".repeat(601) },
    { expiresAt: "2026-10-02T00:00:00Z" },
    { entries: [] },
    {
      entries: Array.from({ length: 101 }, (_, n) => ({
        ...payload.entries[0],
        stableEntryId: `faq-${n}`,
      })),
    },
    { entries: [payload.entries[0], payload.entries[0]] },
    { entries: [{ ...payload.entries[0], stableEntryId: "private/source" }] },
    { entries: [{ ...payload.entries[0], question: "가".repeat(201) }] },
    { entries: [{ ...payload.entries[0], answer: "가".repeat(4001) }] },
    { entries: [{ ...payload.entries[0], actorId: id }] },
  ])("rejects unauthorized scope or malformed entries %j", (change) => {
    expect(faqContentSchema.safeParse({ ...payload, ...change }).success).toBe(
      false,
    );
    expect(
      contentCommandSchema.safeParse({
        ...command,
        payload: { ...payload, ...change },
      }).success,
    ).toBe(false);
  });
  it("checks serialized UTF-8 bytes rather than Korean character count", () => {
    const entries = Array.from({ length: 8 }, (_, n) => ({
      stableEntryId: `faq-${n}`,
      question: "질문",
      answer: "가".repeat(3000),
    }));
    const large = { ...payload, entries };
    expect(JSON.stringify(large).length).toBeLessThan(FAQ_MAX_SERIALIZED_BYTES);
    expect(
      new TextEncoder().encode(JSON.stringify(large)).byteLength,
    ).toBeGreaterThan(FAQ_MAX_SERIALIZED_BYTES);
    expect(isBoundedFaqPayload(large)).toBe(false);
    expect(faqContentSchema.safeParse(large).success).toBe(false);
    expect(
      contentReceiptSchema.safeParse({ ...receipt, snapshot: large }).success,
    ).toBe(false);
  });
  it("does not bypass raw payload byte limit by trimming huge whitespace", () => {
    const padded = {
      ...payload,
      title: `회원 질문${" ".repeat(FAQ_MAX_SERIALIZED_BYTES)}`,
    };
    expect(faqContentSchema.safeParse(padded).success).toBe(true);
    expect(
      contentCommandSchema.safeParse({ ...command, payload: padded }).success,
    ).toBe(false);
    expect(
      contentReceiptSchema.safeParse({ ...receipt, snapshot: padded }).success,
    ).toBe(false);
  });
  it("accounts for native JSONB separator bytes at the serialization boundary", () => {
    const bounded = {
      ...payload,
      entries: Array.from({ length: 17 }, (_, n) => ({
        stableEntryId: `faq-${n}`,
        question: "질문",
        answer: "a".repeat(3700),
      })),
    };
    const exactCompact = {
      ...bounded,
      entries: bounded.entries.map((entry) => ({ ...entry })),
    };
    let remaining =
      FAQ_MAX_SERIALIZED_BYTES -
      new TextEncoder().encode(JSON.stringify(exactCompact)).byteLength;
    for (const entry of exactCompact.entries) {
      const extra = Math.min(300, remaining);
      entry.answer += "a".repeat(extra);
      remaining -= extra;
    }
    expect(remaining).toBe(0);
    expect(
      new TextEncoder().encode(JSON.stringify(exactCompact)).byteLength,
    ).toBe(FAQ_MAX_SERIALIZED_BYTES);
    expect(isBoundedFaqPayload(exactCompact)).toBe(false);
    expect(faqContentSchema.safeParse(exactCompact).success).toBe(false);
    expect(isBoundedFaqPayload(bounded)).toBe(true);
    expect(faqContentSchema.safeParse(bounded).success).toBe(true);
  });
  it.each([
    "<script>alert(1)</script>",
    "service_role",
    "{{unknown_value}}",
    "가상 채굴",
    "C:\\private\\source.txt",
    "D:/private/source.txt",
    "app_private",
    "auth.sessions",
  ])(
    "inspects nested FAQ answer copy before reviewed lifecycle %s",
    (answer) => {
      const unsafe = faqContentSchema.parse({
        ...payload,
        entries: [{ ...payload.entries[0], answer }],
      });
      expect(isSafeContentCopy(unsafe, true)).toBe(false);
      expect(
        contentReceiptSchema.safeParse({
          ...receipt,
          state: "APPROVED",
          snapshot: { ...unsafe, publishedAt: "2026-10-01T00:00:00Z" },
        }).success,
      ).toBe(false);
    },
  );
  it("requires a reviewed schedule and ordered expiration for publication", () => {
    expect(hasValidContentWindow(faqContentSchema.parse(payload), false)).toBe(
      true,
    );
    expect(hasValidContentWindow(faqContentSchema.parse(payload), true)).toBe(
      false,
    );
    const bad = {
      ...payload,
      publishedAt: "2026-10-02T00:00:00Z",
      expiresAt: "2026-10-01T00:00:00Z",
    };
    expect(
      contentCommandSchema.safeParse({ ...command, payload: bad }).success,
    ).toBe(false);
    expect(
      contentReceiptSchema.safeParse({ ...receipt, state: "PUBLISHED" })
        .success,
    ).toBe(false);
  });
  it("allows FAQ ARCHIVE and UPDATE_DRAFT but rejects CANCEL", () => {
    const existing = {
      ...command,
      contentId: id,
      expectedRevision: id,
      expectedDigest: receipt.digest,
      payload: null,
    };
    expect(
      contentCommandSchema.safeParse({ ...existing, operation: "ARCHIVE" })
        .success,
    ).toBe(true);
    expect(
      contentCommandSchema.safeParse({ ...existing, operation: "CANCEL" })
        .success,
    ).toBe(false);
    expect(
      contentCommandSchema.safeParse({
        ...existing,
        operation: "UPDATE_DRAFT",
        payload,
      }).success,
    ).toBe(true);
  });
  it("rejects member projections carrying source/admin/private metadata", () => {
    const dto = {
      contentId: id,
      revisionId: id,
      revision: 1,
      title: payload.title,
      summary: payload.summary,
      locale: payload.locale,
      audience: payload.audience,
      entries: payload.entries,
      sourceDigest: payload.sourceDigest,
      publishedAt: "2026-10-01T00:00:00Z",
      expiresAt: null,
    };
    expect(memberFaqSchema.safeParse(dto).success).toBe(true);
    for (const field of [
      "auditId",
      "actorId",
      "outboxId",
      "sourcePath",
      "draft",
      "stepUpToken",
    ])
      expect(
        memberFaqSchema.safeParse({ ...dto, [field]: "private" }).success,
      ).toBe(false);
  });
});
