import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiAnswerSource } from "@/domain/ai/chat";
import {
  memberAiHelpFromSourceKey,
  type MemberAiHelpTopic,
} from "@/domain/ai/member-help";
import { AI_TOOL_NAMES } from "@/lib/ai/tools";

const HISTORY_MESSAGE_LIMIT = 120;

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
  client_message_id: z.uuid().nullable().optional(),
  created_at: z.iso.datetime({ offset: true }).optional(),
  ai_answer_sources: z
    .array(
      z.object({
        source_key: z.string(),
        knowledge_version: z.string().nullable(),
        position: z.number().int().positive(),
      }),
    )
    .optional(),
  ai_tool_calls: z
    .array(
      z.object({
        tool_name: z.string(),
        outcome: z.enum(["FAILED", "SUCCEEDED"]),
        position: z.number().int().positive(),
      }),
    )
    .optional(),
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
  clientMessageId?: string | null;
  recordedAt?: string;
  source?: AiAnswerSource;
  knowledgeVersion?: string;
  toolOutcome?: "FAILED" | "SUCCEEDED";
  helpTopic?: MemberAiHelpTopic;
};

function messageEvidence(row: z.infer<typeof messageSchema>) {
  const sources = row.ai_answer_sources ?? [];
  const tools = row.ai_tool_calls ?? [];
  const receipt =
    sources.length === 1 && sources[0]?.position === 1 ? sources[0] : null;
  if (!receipt) return {};
  const version = receipt.knowledge_version
    ? { knowledgeVersion: receipt.knowledge_version }
    : {};
  if (receipt.source_key.startsWith("tool:")) {
    const tool =
      tools.length === 1 && tools[0]?.position === 1 ? tools[0] : null;
    if (
      !tool ||
      receipt.source_key !== `tool:${tool.tool_name}` ||
      !AI_TOOL_NAMES.some((name) => name === tool.tool_name)
    )
      return {};
    return { ...version, source: "tool" as const, toolOutcome: tool.outcome };
  }
  if (tools.length) return {};
  const source: AiAnswerSource | undefined =
    receipt.source_key === "guide:provider"
      ? "provider"
      : receipt.source_key === "guide:cache"
        ? "cache"
        : receipt.source_key.startsWith("guide:")
          ? "static"
          : undefined;
  const helpTopic =
    source === "static"
      ? memberAiHelpFromSourceKey(receipt.source_key)
      : undefined;
  return source
    ? { ...version, source, ...(helpTopic ? { helpTopic } : {}) }
    : {};
}

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
  | { messages: readonly OwnAiMessage[]; hasEarlierMessages: boolean; ok: true }
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
    .select(
      "id, author_role, body_text, position, user_id, conversation_id, client_message_id, created_at, ai_answer_sources(source_key, knowledge_version, position), ai_tool_calls(tool_name, outcome, position)",
    )
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("position", { ascending: false })
    .limit(HISTORY_MESSAGE_LIMIT + 1);
  if (error) return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  const parsed = messageSchema.array().safeParse(data ?? []);
  if (!parsed.success)
    return { code: "OWN_CONVERSATION_UNAVAILABLE", ok: false };
  const owned = parsed.data
    .filter(
      (row) => row.user_id === userId && row.conversation_id === conversationId,
    )
    .sort((left, right) => right.position - left.position);
  return {
    hasEarlierMessages: owned.length > HISTORY_MESSAGE_LIMIT,
    messages: owned
      .slice(0, HISTORY_MESSAGE_LIMIT)
      .reverse()
      .map((row) => ({
        authorRole: row.author_role,
        bodyText: row.body_text,
        id: row.id,
        position: row.position,
        ...(row.client_message_id !== undefined
          ? { clientMessageId: row.client_message_id }
          : {}),
        ...(row.created_at ? { recordedAt: row.created_at } : {}),
        ...(row.author_role === "ASSISTANT" ? messageEvidence(row) : {}),
      })),
    ok: true,
  };
}
