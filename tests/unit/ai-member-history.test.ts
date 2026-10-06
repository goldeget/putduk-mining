import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readOwnAiMessages } from "@/lib/ai/member-conversation-read";
import { restoreOwnAiMessages } from "@/components/product/putduk-ai-history";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const SAVED_AT = "2026-10-06T00:00:00Z";
function client(rows: unknown[]) {
  const calls: unknown[][] = [];
  const query = {
    select(value: string) {
      calls.push(["select", value]);
      return query;
    },
    eq(key: string, value: string) {
      calls.push(["eq", key, value]);
      return query;
    },
    order(key: string, value: unknown) {
      calls.push(["order", key, value]);
      return query;
    },
    limit(value: number) {
      calls.push(["limit", value]);
      return query;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return {
    calls,
    supabase: { from: () => query } as unknown as SupabaseClient,
  };
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    author_role: "ASSISTANT",
    body_text: "현재 본인 잔액은 10,000원입니다.",
    conversation_id: CONVERSATION,
    id: MESSAGE,
    position: 2,
    client_message_id: null,
    user_id: OWNER,
    created_at: SAVED_AT,
    ai_answer_sources: [
      {
        source_key: "tool:wallet.summary",
        knowledge_version: "v1",
        position: 1,
      },
    ],
    ai_tool_calls: [
      { tool_name: "wallet.summary", outcome: "SUCCEEDED", position: 1 },
    ],
    ...overrides,
  };
}
describe("own historical AI evidence", () => {
  it("restores public navigation only from the registered owned static receipt", async () => {
    const read = await readOwnAiMessages(
      client([
        row({
          ai_answer_sources: [
            {
              source_key: "guide:member_help_notification_settings",
              knowledge_version: "v1",
              position: 1,
            },
          ],
          ai_tool_calls: [],
        }),
      ]).supabase,
      OWNER,
      CONVERSATION,
    );
    if (!read.ok) throw new Error("read failed");
    expect(read.messages[0]).toMatchObject({
      source: "static",
      helpTopic: "notification_settings",
    });
    expect(restoreOwnAiMessages(CONVERSATION, read.messages)[0]).toMatchObject({
      historical: true,
      helpTopic: "notification_settings",
      source: "static",
    });
  });

  it("restores an owned source receipt and recording time without inventing lookup asOf", async () => {
    const { supabase, calls } = client([row()]);
    const read = await readOwnAiMessages(supabase, OWNER, CONVERSATION);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("read failed");
    expect(calls).toContainEqual(["eq", "user_id", OWNER]);
    expect(calls).toContainEqual(["eq", "conversation_id", CONVERSATION]);
    expect(read.messages[0]).toMatchObject({
      source: "tool",
      toolOutcome: "SUCCEEDED",
      recordedAt: SAVED_AT,
      knowledgeVersion: "v1",
    });
    const restored = restoreOwnAiMessages(CONVERSATION, read.messages)[0];
    expect(restored).toMatchObject({
      state: "complete",
      historical: true,
      recordedAt: SAVED_AT,
    });
    expect(restored?.grounding).toBeUndefined();
  });

  it.each([
    { ai_answer_sources: [] },
    { ai_tool_calls: [] },
    {
      ai_tool_calls: [
        {
          tool_name: "deposit.latest_status",
          outcome: "SUCCEEDED",
          position: 1,
        },
      ],
    },
    {
      ai_tool_calls: [
        { tool_name: "wallet.summary", outcome: "SUCCEEDED", position: 1 },
        { tool_name: "wallet.summary", outcome: "FAILED", position: 2 },
      ],
    },
  ])(
    "keeps missing or inconsistent evidence unverified: %j",
    async (overrides) => {
      const read = await readOwnAiMessages(
        client([row(overrides)]).supabase,
        OWNER,
        CONVERSATION,
      );
      if (!read.ok) throw new Error("read failed");
      expect(restoreOwnAiMessages(CONVERSATION, read.messages)[0]?.state).toBe(
        "unverified",
      );
    },
  );

  it("keeps failure outcome, joins body chunks, and restores the original retry question", () => {
    const restored = restoreOwnAiMessages(CONVERSATION, [
      {
        id: "q",
        authorRole: "MEMBER",
        bodyText: "내 잔액 얼마야?",
        position: 1,
      },
      {
        id: "a",
        authorRole: "ASSISTANT",
        bodyText: "조회 실패.",
        position: 2,
        source: "tool",
        toolOutcome: "FAILED",
      },
      {
        id: "chunk",
        authorRole: "ASSISTANT",
        bodyText: "다시 확인해 주세요.",
        position: 3,
        clientMessageId: null,
      },
    ]);
    expect(restored).toHaveLength(2);
    expect(restored[1]).toMatchObject({
      state: "error",
      text: "조회 실패.\n다시 확인해 주세요.",
      question: "내 잔액 얼마야?",
      failure: { code: "AI_TOOL_UNAVAILABLE" },
    });
  });

  it("keeps separately identified member turns distinct when an earlier answer was never saved", () => {
    const restored = restoreOwnAiMessages(CONVERSATION, [
      {
        id: "q1",
        authorRole: "MEMBER",
        bodyText: "OLD QUESTION",
        position: 1,
        clientMessageId: "turn-a",
      },
      {
        id: "q2",
        authorRole: "MEMBER",
        bodyText: "NEW QUESTION",
        position: 2,
        clientMessageId: "turn-b",
      },
      {
        id: "a2",
        authorRole: "ASSISTANT",
        bodyText: "FAILED LOOKUP",
        position: 3,
        source: "tool",
        toolOutcome: "FAILED",
        clientMessageId: null,
      },
    ]);
    expect(restored).toHaveLength(3);
    expect(restored[2]?.question).toBe("NEW QUESTION");
  });

  it("reads the most recent bounded history and discloses omitted earlier messages", async () => {
    const rows = Array.from({ length: 121 }, (_, i) =>
      row({ position: i + 10 }),
    );
    const { supabase, calls } = client(rows);
    const read = await readOwnAiMessages(supabase, OWNER, CONVERSATION);
    if (!read.ok) throw new Error("read failed");
    expect(calls).toContainEqual(["order", "position", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 121]);
    expect(read.hasEarlierMessages).toBe(true);
    expect(read.messages).toHaveLength(120);
    expect(read.messages[0]?.position).toBe(11);
    expect(read.messages.at(-1)?.position).toBe(130);
  });
});
