import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  listOwnAiConversations,
  readOwnAiMessages,
} from "@/lib/ai/member-conversation-read";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const TIME = "2026-10-13T01:02:03.123456+00:00";
const id = (value: number) =>
  `33333333-3333-4333-8333-${String(value).padStart(12, "0")}`;

function client(rows: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  const from = vi.fn(() => query);
  return { query, from, supabase: { from } as unknown as SupabaseClient };
}

describe("owned AI history keyset pages", () => {
  it("bounds the conversation page and carries the last displayed timestamp/id tie-break", async () => {
    const { supabase, query } = client(
      Array.from({ length: 41 }, (_, index) => ({
        id: id(100 - index),
        title_text: `대화 ${index}`,
        updated_at: TIME,
        user_id: OWNER,
      })),
    );
    const result = await listOwnAiConversations(supabase, OWNER);
    expect(query.eq).toHaveBeenCalledWith("user_id", OWNER);
    expect(query.order.mock.calls).toEqual([
      ["updated_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(query.limit).toHaveBeenCalledWith(41);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("owned page unavailable");
    expect(result.conversations).toHaveLength(40);
    expect(result.nextCursor).toEqual({ id: id(61), updatedAt: TIME });
    expect(result.hasMore).toBe(true);
  });

  it("uses a validated keyset rather than an offset for subsequent conversations", async () => {
    const { supabase, query } = client([]);
    expect(
      await listOwnAiConversations(supabase, OWNER, {
        id: id(61),
        updatedAt: TIME,
      }),
    ).toMatchObject({ ok: true, hasMore: false, nextCursor: null });
    expect(query.or).toHaveBeenCalledWith(
      `updated_at.lt.${TIME},and(updated_at.eq.${TIME},id.lt.${id(61)})`,
    );
  });

  it("rejects cursor injection and malformed timestamps before any query", async () => {
    const { supabase, from } = client([]);
    for (const cursor of [
      { id: "bad),user_id.neq.owner", updatedAt: TIME },
      { id: id(61), updatedAt: "2026),id.gt.0" },
    ]) {
      expect(await listOwnAiConversations(supabase, OWNER, cursor)).toEqual({
        ok: false,
        code: "OWN_CONVERSATION_UNAVAILABLE",
      });
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a nonadvancing or duplicate conversation page", async () => {
    const row = {
      id: id(61),
      title_text: "대화",
      updated_at: TIME,
      user_id: OWNER,
    };
    expect(
      await listOwnAiConversations(client([row]).supabase, OWNER, {
        id: id(61),
        updatedAt: TIME,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await listOwnAiConversations(client([row, row]).supabase, OWNER),
    ).toMatchObject({ ok: false });
  });

  it("reads older positions in a fixed bounded page while retaining owner/conversation predicates", async () => {
    const { supabase, query } = client(
      Array.from({ length: 121 }, (_, index) => ({
        id: id(200 - index),
        author_role: "MEMBER",
        body_text: `기록 ${index}`,
        conversation_id: CONVERSATION,
        user_id: OWNER,
        position: 200 - index,
      })),
    );
    const result = await readOwnAiMessages(supabase, OWNER, CONVERSATION, 201);
    expect(query.eq.mock.calls).toEqual([
      ["user_id", OWNER],
      ["conversation_id", CONVERSATION],
    ]);
    expect(query.lt).toHaveBeenCalledWith("position", 201);
    expect(query.limit).toHaveBeenCalledWith(121);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("owned page unavailable");
    expect(result.messages).toHaveLength(120);
    expect(result.messages[0]?.position).toBe(81);
    expect(result.messages.at(-1)?.position).toBe(200);
    expect(result.hasEarlierMessages).toBe(true);
  });

  it("rejects invalid positions before reading and refuses a cursor-overlapping server row", async () => {
    const { supabase, from } = client([]);
    for (const cursor of [0, -1, 1.5, NaN, 2_147_483_648]) {
      expect(
        await readOwnAiMessages(supabase, OWNER, CONVERSATION, cursor),
      ).toMatchObject({ ok: false });
    }
    expect(from).not.toHaveBeenCalled();
    expect(
      await readOwnAiMessages(
        client([
          {
            id: id(3),
            author_role: "MEMBER",
            body_text: "중복",
            conversation_id: CONVERSATION,
            user_id: OWNER,
            position: 3,
          },
        ]).supabase,
        OWNER,
        CONVERSATION,
        3,
      ),
    ).toMatchObject({ ok: false });
  });
});
