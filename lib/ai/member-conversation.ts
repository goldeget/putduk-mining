import type { SupabaseClient } from "@supabase/supabase-js";

import {
  conversationTitle,
  redactMemberTranscript,
  sanitizeKnowledgeVersion,
  sanitizeSourceKey,
  splitStoredBody,
} from "@/domain/ai/member-transcript";
import {
  decideMemberLearningPublication,
  knowledgePublishAllowed,
} from "@/domain/ai/member-learning";

export class MemberConversationWriteError extends Error {
  readonly reason: "CONFLICT" | "FAILED" | "NOT_OWN";

  constructor(reason: "CONFLICT" | "FAILED" | "NOT_OWN") {
    super(reason);
    this.name = "MemberConversationWriteError";
    this.reason = reason;
  }
}

type MessageInsert = {
  authorRole: "ASSISTANT" | "MEMBER";
  bodyText: string;
  clientMessageId?: string;
  conversationId: string;
  position: number;
  userId: string;
};

type ToolCallInsert = {
  conversationId: string;
  latencyMs: number | null;
  messageId: string;
  outcome: "FAILED" | "SUCCEEDED";
  toolName: string;
  userId: string;
};

type SourceInsert = {
  conversationId: string;
  knowledgeVersion: string | null;
  messageId: string;
  sourceKey: string;
  userId: string;
};

type FeedbackInsert = {
  conversationId: string;
  messageId: string;
  rating: "DOWN" | "UP";
  reasonCode:
    | "ACCOUNT_MISMATCH"
    | "HARD_TO_UNDERSTAND"
    | "INCORRECT"
    | "NOT_THE_ANSWER"
    | "OTHER"
    | "OUTDATED"
    | null;
  userId: string;
};

export type MemberConversationPort = {
  findAssistantAfter: (
    userId: string,
    conversationId: string,
    afterPosition: number,
    expected?: {
      answerParts: readonly string[];
      clientMessageId: string;
      questionParts: readonly string[];
    },
  ) => Promise<string | null>;
  findMemberMessage: (
    userId: string,
    clientMessageId: string,
  ) => Promise<{
    conversationId: string;
    messageId: string;
    position: number;
  } | null>;
  findOwnAssistantMessage: (
    userId: string,
    conversationId: string,
    messageId: string,
  ) => Promise<boolean>;
  findOwnConversation: (
    userId: string,
    conversationId: string,
  ) => Promise<boolean>;
  insertConversation: (userId: string, title: string) => Promise<string>;
  insertFeedback: (row: FeedbackInsert) => Promise<void>;
  insertMessage: (row: MessageInsert) => Promise<string>;
  insertSource: (row: SourceInsert) => Promise<void>;
  insertToolCall: (row: ToolCallInsert) => Promise<void>;
  maxPosition: (userId: string, conversationId: string) => Promise<number>;
  touchConversation: (userId: string, conversationId: string) => Promise<void>;
};

export type MemberTurnDraft = {
  answer: string;
  clientMessageId: string;
  conversationId?: string;
  knowledgeVersion: string | null;
  question: string;
  sourceKey: string;
  toolCall?: {
    latencyMs: number | null;
    outcome: "FAILED" | "SUCCEEDED";
    toolName: string;
  };
  userId: string;
};

export type AppendOwnMemberTurnResult =
  | {
      assistantMessageId: string;
      conversationId: string;
      ok: true;
    }
  | { code: "CONVERSATION_NOT_SAVED" | "NOT_OWN_CONVERSATION"; ok: false };

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.]{0,79}$/;

function failureCode(error: unknown) {
  if (
    error instanceof MemberConversationWriteError &&
    error.reason === "NOT_OWN"
  ) {
    return "NOT_OWN_CONVERSATION" as const;
  }
  return "CONVERSATION_NOT_SAVED" as const;
}

function latencyOrNull(value: number | null) {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

async function insertAtNextPosition(
  port: MemberConversationPort,
  row: Omit<MessageInsert, "position">,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const position =
      (await port.maxPosition(row.userId, row.conversationId)) + 1;
    try {
      const id = await port.insertMessage({ ...row, position });
      return { id, position };
    } catch (error) {
      if (
        error instanceof MemberConversationWriteError &&
        error.reason === "CONFLICT" &&
        attempt === 0
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new MemberConversationWriteError("FAILED");
}

export async function appendOwnMemberTurn(
  port: MemberConversationPort,
  input: MemberTurnDraft,
): Promise<AppendOwnMemberTurnResult> {
  const decision = decideMemberLearningPublication(
    `${input.question}\n${input.answer}`,
  );
  if (knowledgePublishAllowed(decision.action)) {
    return { code: "CONVERSATION_NOT_SAVED", ok: false };
  }

  const question = redactMemberTranscript(input.question);
  const answer = redactMemberTranscript(input.answer);
  const questionParts = splitStoredBody(question);
  const answerParts = splitStoredBody(answer);

  try {
    const existing = await port.findMemberMessage(
      input.userId,
      input.clientMessageId,
    );
    if (
      existing &&
      input.conversationId &&
      existing.conversationId !== input.conversationId
    ) {
      return { code: "NOT_OWN_CONVERSATION", ok: false };
    }

    let conversationId = existing?.conversationId ?? input.conversationId;
    if (!conversationId) {
      conversationId = await port.insertConversation(
        input.userId,
        conversationTitle(question),
      );
    } else if (!existing) {
      const owned = await port.findOwnConversation(
        input.userId,
        conversationId,
      );
      if (!owned) return { code: "NOT_OWN_CONVERSATION", ok: false };
    }

    let memberPosition = existing?.position;
    if (!existing) {
      const first = questionParts[0] ?? "내용이 가려졌어요.";
      const inserted = await insertAtNextPosition(port, {
        authorRole: "MEMBER",
        bodyText: first,
        clientMessageId: input.clientMessageId,
        conversationId,
        userId: input.userId,
      });
      memberPosition = inserted.position;
      for (const part of questionParts.slice(1)) {
        await insertAtNextPosition(port, {
          authorRole: "MEMBER",
          bodyText: part,
          conversationId,
          userId: input.userId,
        });
      }
    }

    if (memberPosition === undefined) {
      throw new MemberConversationWriteError("FAILED");
    }

    const assistant = await port.findAssistantAfter(
      input.userId,
      conversationId,
      memberPosition,
      { answerParts, clientMessageId: input.clientMessageId, questionParts },
    );
    if (assistant) {
      // A stored answer is not a completed turn until its evidence is present.
      // The production port also verifies the persisted message body/owner.
      await saveTurnEvidence(port, input, conversationId, assistant);
      return { assistantMessageId: assistant, conversationId, ok: true };
    }

    const firstAnswer = answerParts[0] ?? "내용이 가려졌어요.";
    // Do not move this answer behind a concurrently inserted member question.
    // A position conflict fails closed rather than attributing it to that turn.
    const assistantId = await port.insertMessage({
      authorRole: "ASSISTANT",
      bodyText: firstAnswer,
      conversationId,
      position: memberPosition + questionParts.length,
      userId: input.userId,
    });
    for (const [index, part] of answerParts.slice(1).entries()) {
      await port.insertMessage({
        authorRole: "ASSISTANT",
        bodyText: part,
        conversationId,
        position: memberPosition + questionParts.length + index + 1,
        userId: input.userId,
      });
    }

    await saveTurnEvidence(port, input, conversationId, assistantId);
    return {
      assistantMessageId: assistantId,
      conversationId,
      ok: true,
    };
  } catch (error) {
    return { code: failureCode(error), ok: false };
  }
}

async function saveTurnEvidence(
  port: MemberConversationPort,
  input: MemberTurnDraft,
  conversationId: string,
  messageId: string,
) {
  if (input.toolCall) {
    if (!TOOL_NAME_PATTERN.test(input.toolCall.toolName)) {
      throw new MemberConversationWriteError("FAILED");
    }
    await port.insertToolCall({
      conversationId,
      latencyMs: latencyOrNull(input.toolCall.latencyMs),
      messageId,
      outcome: input.toolCall.outcome,
      toolName: input.toolCall.toolName,
      userId: input.userId,
    });
  }
  await port.insertSource({
    conversationId,
    knowledgeVersion: sanitizeKnowledgeVersion(input.knowledgeVersion),
    messageId,
    sourceKey: sanitizeSourceKey(input.sourceKey),
    userId: input.userId,
  });
  await port.touchConversation(input.userId, conversationId);
}

export async function recordOwnMemberFeedback(
  port: MemberConversationPort,
  input: FeedbackInsert,
) {
  try {
    const owned = await port.findOwnAssistantMessage(
      input.userId,
      input.conversationId,
      input.messageId,
    );
    if (!owned) return { code: "NOT_OWN_MESSAGE" as const, ok: false as const };
    await port.insertFeedback(input);
    return { ok: true as const };
  } catch (error) {
    if (
      error instanceof MemberConversationWriteError &&
      error.reason === "CONFLICT"
    ) {
      return { code: "FEEDBACK_EXISTS" as const, ok: false as const };
    }
    return { code: "FEEDBACK_NOT_SAVED" as const, ok: false as const };
  }
}

function writeError(error: { code?: string } | null) {
  if (error?.code === "23505")
    return new MemberConversationWriteError("CONFLICT");
  if (error?.code === "23503")
    return new MemberConversationWriteError("NOT_OWN");
  return new MemberConversationWriteError("FAILED");
}

async function insertEvidenceOnce(
  supabase: SupabaseClient,
  table: "ai_answer_sources" | "ai_tool_calls",
  row: Record<string, string | number | null>,
) {
  const { error } = await supabase.from(table).insert(row);
  if (!error) return;
  if (error.code !== "23505") throw writeError(error);
  const { data: existing, error: readError } = await supabase
    .from(table)
    .select(Object.keys(row).join(","))
    .eq("user_id", row.user_id)
    .eq("conversation_id", row.conversation_id)
    .eq("message_id", row.message_id)
    .eq("position", row.position)
    .maybeSingle();
  // Conflict is only idempotent success for this owner's identical evidence.
  // A different source, version or tool receipt is never overwritten.
  if (readError || !existing
    || Object.entries(row).some(([key, value]) =>
      (existing as unknown as Record<string, unknown>)[key] !== value)) {
    throw new MemberConversationWriteError("CONFLICT");
  }
}

export function createSupabaseMemberConversationPort(
  supabase: SupabaseClient,
): MemberConversationPort {
  return {
    async findAssistantAfter(userId, conversationId, afterPosition, expected) {
      if (expected) {
        const expectedBodies = [
          ...expected.questionParts,
          ...expected.answerParts,
        ];
        const { data: rows, error: readError } = await supabase
          .from("ai_messages")
          .select("id, user_id, conversation_id, author_role, body_text, position, client_message_id")
          .eq("user_id", userId)
          .eq("conversation_id", conversationId)
          .gte("position", afterPosition)
          .order("position", { ascending: true })
          .limit(expectedBodies.length + 1);
        if (readError || !Array.isArray(rows)) {
          throw new MemberConversationWriteError("FAILED");
        }
        for (const [index, row] of rows.entries()) {
          if (index === expectedBodies.length) {
            if (row.author_role !== "MEMBER") {
              throw new MemberConversationWriteError("CONFLICT");
            }
            break;
          }
          const role = index < expected.questionParts.length
            ? "MEMBER" : "ASSISTANT";
          if (row.user_id !== userId || row.conversation_id !== conversationId
            || typeof row.id !== "string"
            || row.position !== afterPosition + index
            || row.author_role !== role
            || row.body_text !== expectedBodies[index]
            || (index === 0
              ? row.client_message_id !== expected.clientMessageId
              : row.client_message_id !== null)) {
            throw new MemberConversationWriteError("CONFLICT");
          }
        }
        if (rows.length === expected.questionParts.length) return null;
        // Partial multi-chunk answers must not become saved:true. A later
        // atomic turn-storage change is needed for arbitrary chunk recovery.
        if (rows.length < expectedBodies.length) {
          throw new MemberConversationWriteError("FAILED");
        }
        return rows[expected.questionParts.length].id as string;
      }
      const { data, error } = await supabase
        .from("ai_messages")
        .select("id, author_role")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .gt("position", afterPosition)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new MemberConversationWriteError("FAILED");
      if (!data || data.author_role !== "ASSISTANT") return null;
      return typeof data.id === "string" ? data.id : null;
    },
    async findMemberMessage(userId, clientMessageId) {
      const { data, error } = await supabase
        .from("ai_messages")
        .select("id, conversation_id, position")
        .eq("user_id", userId)
        .eq("client_message_id", clientMessageId)
        .maybeSingle();
      if (error) throw new MemberConversationWriteError("FAILED");
      if (
        !data ||
        typeof data.id !== "string" ||
        typeof data.conversation_id !== "string" ||
        typeof data.position !== "number"
      ) {
        return null;
      }
      return {
        conversationId: data.conversation_id,
        messageId: data.id,
        position: data.position,
      };
    },
    async findOwnAssistantMessage(userId, conversationId, messageId) {
      const { data, error } = await supabase
        .from("ai_messages")
        .select("id")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .eq("author_role", "ASSISTANT")
        .maybeSingle();
      if (error) throw new MemberConversationWriteError("FAILED");
      return Boolean(data?.id);
    },
    async findOwnConversation(userId, conversationId) {
      const { data, error } = await supabase
        .from("ai_conversations")
        .select("id")
        .eq("user_id", userId)
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw new MemberConversationWriteError("FAILED");
      return Boolean(data?.id);
    },
    async insertConversation(userId, title) {
      const { data, error } = await supabase
        .from("ai_conversations")
        .insert({ title_text: title, user_id: userId })
        .select("id")
        .single();
      if (error || typeof data?.id !== "string") throw writeError(error);
      return data.id;
    },
    async insertFeedback(row) {
      const { error } = await supabase.from("ai_feedback").insert({
        author_role: "ASSISTANT",
        conversation_id: row.conversationId,
        message_id: row.messageId,
        rating: row.rating,
        reason_code: row.reasonCode,
        user_id: row.userId,
      });
      if (error) throw writeError(error);
    },
    async insertMessage(row) {
      const { data, error } = await supabase
        .from("ai_messages")
        .insert({
          author_role: row.authorRole,
          body_text: row.bodyText,
          conversation_id: row.conversationId,
          position: row.position,
          user_id: row.userId,
          ...(row.clientMessageId
            ? { client_message_id: row.clientMessageId }
            : {}),
        })
        .select("id")
        .single();
      if (error || typeof data?.id !== "string") throw writeError(error);
      return data.id;
    },
    async insertSource(row) {
      await insertEvidenceOnce(supabase, "ai_answer_sources", {
        author_role: "ASSISTANT",
        conversation_id: row.conversationId,
        knowledge_version: row.knowledgeVersion,
        message_id: row.messageId,
        position: 1,
        source_key: row.sourceKey,
        user_id: row.userId,
      });
    },
    async insertToolCall(row) {
      await insertEvidenceOnce(supabase, "ai_tool_calls", {
        author_role: "ASSISTANT",
        conversation_id: row.conversationId,
        latency_ms: row.latencyMs,
        message_id: row.messageId,
        outcome: row.outcome,
        position: 1,
        tool_name: row.toolName,
        user_id: row.userId,
      });
    },
    async maxPosition(userId, conversationId) {
      const { data, error } = await supabase
        .from("ai_messages")
        .select("position")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new MemberConversationWriteError("FAILED");
      return typeof data?.position === "number" ? data.position : 0;
    },
    async touchConversation(userId, conversationId) {
      const { error } = await supabase
        .from("ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("id", conversationId);
      if (error) throw new MemberConversationWriteError("FAILED");
    },
  };
}
