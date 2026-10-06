import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const summarySchema = z.object({
  id: z.uuid(),
  title_text: z.string().nullable(),
  updated_at: z.string().min(1),
  user_id: z.uuid(),
});

const messageSchema = z.object({
  author_role: z.enum(["ASSISTANT", "MEMBER"]),
  body_text: z.string().min(1),
  conversation_id: z.uuid(),
  id: z.uuid(),
  position: z.number().int().positive(),
  user_id: z.uuid(),
});

export type OwnAiConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type OwnAiMessage = {
  authorRole: "ASSISTANT" | "MEMBER";
  bodyText: string;
  id: string;
  position: number;
};

export async function listOwnAiConversations(
  supabase: SupabaseClient,
  userId: string,
): Promise<
  | { conversations: readonly OwnAiConversationSummary[]; ok: true }
  | { code: "OWN_CONVERSATION_UNAVAILABLE"; ok: false }
> {
  if (!z.uuid().safeParse(userId).success) {
    return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  }
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title_text, updated_at, user_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  const conversations = summarySchema
    .array()
    .safeParse(data ?? [])
    .data?.flatMap((row) =>
      row.user_id === userId
        ? [
            {
              id: row.id,
              title: row.title_text?.trim() || "새 대화",
              updatedAt: row.updated_at,
            },
          ]
        : [],
    );
  if (!conversations)
    return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  return { conversations, ok: true };
}

export async function readOwnAiMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<
  | { messages: readonly OwnAiMessage[]; ok: true }
  | { code: "OWN_CONVERSATION_UNAVAILABLE"; ok: false }
> {
  if (
    !z.uuid().safeParse(userId).success ||
    !z.uuid().safeParse(conversationId).success
  ) {
    return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  }
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, author_role, body_text, position, user_id, conversation_id")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("position", { ascending: true })
    .limit(120);
  if (error) return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  const parsed = messageSchema.array().safeParse(data ?? []);
  if (!parsed.success)
    return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  return {
    messages: parsed.data.flatMap((row) =>
      row.user_id === userId && row.conversation_id === conversationId
        ? [
            {
              authorRole: row.author_role,
              bodyText: row.body_text,
              id: row.id,
              position: row.position,
            },
          ]
        : [],
    ),
    ok: true,
  };
}
