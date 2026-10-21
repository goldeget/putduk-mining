import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  appendOwnMemberTurn,
  createSupabaseMemberConversationPort,
} from "@/lib/ai/member-conversation";
import { splitStoredBody } from "@/domain/ai/member-transcript";

const owner = "11111111-1111-4111-8111-111111111111";
const clientMessage = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const assistant = "44444444-4444-4444-8444-444444444444";
const draft = {
  userId: owner,
  clientMessageId: clientMessage,
  question: "긴 답변을 저장해 주세요.",
  answer: "가".repeat(20_000),
  sourceKey: "guide:provider",
  knowledgeVersion: "2026.09",
};

describe("atomic durable member turns", () => {
  it("binds the caller cancellation signal to the canonical atomic storage command", async () => {
    const member = new AbortController();
    let storageSignal: AbortSignal | undefined;
    const receipt = {
      error: null,
      data: {
        conversationId: conversation,
        assistantMessageId: assistant,
        replay: false,
      },
    };
    const rpc = vi.fn(() => ({
      abortSignal(signal: AbortSignal) {
        storageSignal = signal;
        return Promise.resolve(receipt);
      },
    }));
    const port = createSupabaseMemberConversationPort(
      { rpc } as unknown as SupabaseClient,
      { signal: member.signal },
    );
    expect(await appendOwnMemberTurn(port, draft)).toMatchObject({
      ok: true,
      conversationId: conversation,
    });
    member.abort();
    expect(storageSignal?.aborted).toBe(true);
  });
  it("preserves whitespace and Unicode at the original 8000-character fragment boundary", () => {
    const body = "가".repeat(7999) + " \n😀" + "나".repeat(8000);
    const parts = splitStoredBody(body);
    expect(parts.join("")).toBe(body);
    expect(parts.every((part) => Array.from(part).length <= 8000)).toBe(true);
  });
  it("submits every fragment and its evidence in one canonical transaction without individual writes", async () => {
    const rpc = vi.fn(async (...args: [string, Record<string, unknown>]) => {
      void args;
      return {
        error: null,
        data: {
          conversationId: conversation,
          assistantMessageId: assistant,
          replay: false,
        },
      };
    });
    const from = vi.fn();
    const saved = await appendOwnMemberTurn(
      createSupabaseMemberConversationPort({
        rpc,
        from,
      } as unknown as SupabaseClient),
      draft,
    );
    expect(saved).toEqual({
      ok: true,
      conversationId: conversation,
      assistantMessageId: assistant,
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("append_ai_member_turn");
    expect(args.p_answer_parts).toHaveLength(3);
    expect((args.p_answer_parts as string[]).join("")).toBe(draft.answer);
    expect(args.p_user_id).toBe(owner);
    expect(args.p_client_message_id).toBe(clientMessage);
    expect(args.p_source_key).toBe("guide:provider");
  });
  it("never retries a partial legacy write or missing atomic migration with individual inserts", async () => {
    const rpc = vi.fn(async () => ({ error: { code: "55000" }, data: null }));
    const from = vi.fn();
    const saved = await appendOwnMemberTurn(
      createSupabaseMemberConversationPort({
        rpc,
        from,
      } as unknown as SupabaseClient),
      draft,
    );
    expect(saved).toEqual({ ok: false, code: "CONVERSATION_NOT_SAVED" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("requires a verified full receipt, and redacts PII before the transaction", async () => {
    const rpc = vi.fn(async () => ({
      error: null,
      data: { conversationId: conversation, replay: false },
    }));
    const result = await appendOwnMemberTurn(
      createSupabaseMemberConversationPort({
        rpc,
      } as unknown as SupabaseClient),
      {
        ...draft,
        question: "연락 a@example.com 010-1234-5678",
        answer: "password = secret passphrase",
      },
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("example.com");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("1234");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("secret passphrase");
  });
});
