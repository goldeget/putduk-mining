import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { aiChatRequestSchema } from "@/domain/ai/chat";
import { aiMemberFeedbackSchema } from "@/domain/ai/member-feedback";
import {
  AI_MEMBER_BLOCKED_POLICY,
  decideMemberLearningPublication,
  knowledgePublishAllowed,
} from "@/domain/ai/member-learning";
import {
  conversationTitle,
  redactMemberTranscript,
  splitStoredBody,
} from "@/domain/ai/member-transcript";
import {
  appendOwnMemberTurn,
  type MemberConversationPort,
} from "@/lib/ai/member-conversation";
import {
  listOwnAiConversations,
  readOwnAiMessages,
} from "@/lib/ai/member-conversation-read";
import { buildMemberProviderRequestBody } from "@/lib/ai/provider-turn";
import { executeAiTool } from "@/lib/ai/tool-executor";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const CLIENT_MESSAGE = "55555555-5555-4555-8555-555555555555";

const SEED =
  "abandon ability able about above absent absorb abstract absurd abuse access accident";

function createMemoryPort(owned = true) {
  const messages: Array<{
    authorRole: "ASSISTANT" | "MEMBER";
    bodyText: string;
    clientMessageId?: string;
    conversationId: string;
    id: string;
    position: number;
    userId: string;
  }> = [];
  const toolCalls: unknown[] = [];
  const sources: unknown[] = [];
  let sequence = 0;
  const port: MemberConversationPort = {
    async findAssistantAfter(userId, conversationId, afterPosition) {
      const next = messages.find(
        (row) =>
          row.userId === userId &&
          row.conversationId === conversationId &&
          row.position > afterPosition,
      );
      return next?.authorRole === "ASSISTANT" ? next.id : null;
    },
    async findMemberMessage(userId, clientMessageId) {
      const row = messages.find(
        (item) =>
          item.userId === userId && item.clientMessageId === clientMessageId,
      );
      return row
        ? {
            conversationId: row.conversationId,
            messageId: row.id,
            position: row.position,
          }
        : null;
    },
    async findOwnAssistantMessage() {
      return false;
    },
    async findOwnConversation(userId) {
      return owned && userId === ACTOR;
    },
    async insertConversation(userId, title) {
      sequence += 1;
      return `conversation-${userId}-${sequence}-${title.length}`;
    },
    async insertFeedback() {
      return undefined;
    },
    async insertMessage(row) {
      sequence += 1;
      const id = `message-${sequence}`;
      messages.push({ ...row, id });
      return id;
    },
    async insertSource(row) {
      sources.push(row);
    },
    async insertToolCall(row) {
      toolCalls.push(row);
    },
    async maxPosition(userId, conversationId) {
      return messages
        .filter(
          (row) =>
            row.userId === userId && row.conversationId === conversationId,
        )
        .reduce((max, row) => Math.max(max, row.position), 0);
    },
    async touchConversation() {
      return undefined;
    },
  };
  return { messages, port, sources, toolCalls };
}

describe("회원 AI 본문 가림", () => {
  it("비밀번호, 토큰, 시드 원문을 저장 문자열에 남기지 않는다", () => {
    const secret = "hunter2";
    const token = "sk-test-abcdef123456";
    const bearer = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";
    const text = redactMemberTranscript(
      `비밀번호는 ${secret} 입니다. otp 482913. ${token}. ${bearer}. 시드 문구 ${SEED}`,
    );
    expect(text).not.toContain(secret);
    expect(text).not.toContain(token);
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(text).not.toContain("482913");
    expect(text).not.toContain("abandon");
    expect(text).toContain("[가림]");
  });

  it("따옴표, 조사, 한국어 토큰 라벨 뒤의 원문도 저장 문자열에서 뺀다", () => {
    const quotedPassword = redactMemberTranscript('비밀번호는 "hunter2" 입니다');
    const englishPassword = redactMemberTranscript("password is hunter2 now");
    const koreanToken = redactMemberTranscript(
      "내 토큰은 eyJhbGciOiJIUzI1NiJ9.payload.signature",
    );
    const quotedSeed = redactMemberTranscript(`시드 문구 "${SEED}"`);
    expect(quotedPassword).not.toContain("hunter2");
    expect(englishPassword).not.toContain("hunter2");
    expect(koreanToken).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(koreanToken).not.toContain("payload");
    expect(quotedSeed).not.toContain("abandon");
  });

  it("일반 질문과 비밀번호라는 단어만 있는 문장은 그대로 둔다", () => {
    expect(redactMemberTranscript("오늘 채굴은 어떻게 보나요?")).toBe(
      "오늘 채굴은 어떻게 보나요?",
    );
    expect(redactMemberTranscript("비밀번호는 무엇인가요")).toBe(
      "비밀번호는 무엇인가요",
    );
  });

  it("제목과 본문 길이를 저장 한도 안에 둔다", () => {
    const long = "가".repeat(8_100);
    expect(Array.from(conversationTitle(long)).length).toBeLessThanOrEqual(80);
    const parts = splitStoredBody(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Array.from(part).length).toBeLessThanOrEqual(8_000);
      expect(part.trim()).toBe(part);
    }
  });
});

describe("회원 AI 학습 공개 경계", () => {
  it("고위험 금융·권한 내용은 승인 대기까지만 두고 공개하지 않는다", () => {
    const decision =
      decideMemberLearningPublication("출금 수수료와 권한을 바꿔 주세요");
    expect(decision).toMatchObject({
      action: "AWAITING_APPROVAL",
      policy: "LEARNING_CANDIDATE_STORAGE_ABSENT",
      risk: "LEARNING_HIGH",
    });
    expect(knowledgePublishAllowed(decision.action)).toBe(false);
    expect(knowledgePublishAllowed("PUBLISHED")).toBe(false);
    expect(knowledgePublishAllowed("BLOCKED_POLICY")).toBe(false);
  });

  it("점수와 canary가 없으므로 낮은 위험도도 자동 공개하지 않는다", () => {
    expect(decideMemberLearningPublication("메뉴는 어디 있나요")).toMatchObject(
      {
        action: "BLOCKED_POLICY",
        policy: "AUTO_PUBLISH_SCORE_UNSET",
        risk: "LEARNING_MEDIUM",
      },
    );
    expect(AI_MEMBER_BLOCKED_POLICY).toEqual([
      "RETENTION_PERIOD_UNSET",
      "PROVIDER_TRANSMISSION_SCOPE_UNSET",
      "AUTO_PUBLISH_SCORE_UNSET",
      "CANARY_RATIO_UNSET",
      "LEARNING_CANDIDATE_STORAGE_ABSENT",
      "CONVERSATION_SUMMARY_TRANSMISSION_UNSET",
    ]);
  });
});

describe("회원 본인 대화 저장", () => {
  it("다른 회원의 대화에는 메시지를 붙이지 않는다", async () => {
    const memory = createMemoryPort(false);
    const saved = await appendOwnMemberTurn(memory.port, {
      answer: "본인 안내예요.",
      clientMessageId: CLIENT_MESSAGE,
      conversationId: CONVERSATION,
      knowledgeVersion: "2026.09",
      question: "내 대화를 이어서 볼 수 있나요",
      sourceKey: "guide:owner",
      userId: ACTOR,
    });
    expect(saved).toEqual({ code: "NOT_OWN_CONVERSATION", ok: false });
    expect(memory.messages).toHaveLength(0);
  });

  it("비밀값 원문과 도구 결과 본문을 도구 행에 남기지 않고 같은 질문 id는 한 번만 남긴다", async () => {
    const memory = createMemoryPort();
    const question = "비밀번호는 hunter2 입니다. 채굴은 어떻게 보나요";
    const answer = "확정 잔액은 98000원입니다.";
    const input = {
      answer,
      clientMessageId: CLIENT_MESSAGE,
      knowledgeVersion: "2026.09",
      question,
      sourceKey: "tool:wallet.summary",
      toolCall: {
        latencyMs: 12,
        outcome: "SUCCEEDED" as const,
        toolName: "wallet.summary",
      },
      userId: ACTOR,
    };
    const saved = await appendOwnMemberTurn(memory.port, input);
    expect(saved.ok).toBe(true);
    expect(memory.messages.every((row) => row.userId === ACTOR)).toBe(true);
    expect(JSON.stringify(memory.messages)).not.toContain("hunter2");
    expect(JSON.stringify(memory.toolCalls)).not.toContain("98000");
    expect(JSON.stringify(memory.toolCalls)).not.toContain(answer);
    expect(Object.keys(memory.toolCalls[0] as object).sort()).toEqual([
      "conversationId",
      "latencyMs",
      "messageId",
      "outcome",
      "toolName",
      "userId",
    ]);
    const memberCount = memory.messages.filter(
      (row) => row.authorRole === "MEMBER",
    ).length;
    const again = await appendOwnMemberTurn(memory.port, input);
    expect(again).toEqual(saved);
    expect(
      memory.messages.filter((row) => row.authorRole === "MEMBER"),
    ).toHaveLength(memberCount);
  });

  it("고위험 질문도 대화 본문은 남기지만 학습 행은 만들지 않는다", async () => {
    const memory = createMemoryPort();
    const saved = await appendOwnMemberTurn(memory.port, {
      answer: "수수료는 화면의 안내만 확인해 주세요.",
      clientMessageId: CLIENT_MESSAGE,
      knowledgeVersion: "2026.09",
      question: "출금 수수료가 궁금해요",
      sourceKey: "guide:fee",
      userId: ACTOR,
    });
    expect(saved.ok).toBe(true);
    expect(memory.messages.length).toBeGreaterThan(0);
    const source = readFileSync(
      path.join(process.cwd(), "lib/ai/member-conversation.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /ai_learning_candidates|ai_conversation_summaries|ai_knowledge/,
    );
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/console\./);
  });
});

describe("회원 본인 대화 읽기", () => {
  it("조회 조건과 결과에서 다른 회원을 뺀다", async () => {
    const filters: Array<[string, unknown]> = [];
    const rows = [
      {
        id: CONVERSATION,
        title_text: "내 대화",
        updated_at: "2026-10-06T00:00:00.000Z",
        user_id: ACTOR,
      },
      {
        id: MESSAGE,
        title_text: "다른 회원",
        updated_at: "2026-10-06T00:00:00.000Z",
        user_id: OTHER,
      },
    ];
    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve({ data: rows, error: null }).then(
          resolve,
          reject,
        );
      },
    };
    const client = {
      from: () => builder,
    } as unknown as SupabaseClient;
    const listed = await listOwnAiConversations(client, ACTOR);
    expect(filters).toContainEqual(["user_id", ACTOR]);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.conversations.map((item) => item.id)).toEqual([
        CONVERSATION,
      ]);
      expect(JSON.stringify(listed.conversations)).not.toContain("다른 회원");
    }
  });

  it("메시지 읽기도 본인 대화만 남긴다", async () => {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve({
          data: [
            {
              author_role: "MEMBER",
              body_text: "내 질문",
              conversation_id: CONVERSATION,
              id: MESSAGE,
              position: 1,
              user_id: ACTOR,
            },
            {
              author_role: "MEMBER",
              body_text: "다른 질문",
              conversation_id: CONVERSATION,
              id: CLIENT_MESSAGE,
              position: 2,
              user_id: OTHER,
            },
          ],
          error: null,
        }).then(resolve, reject);
      },
    };
    const read = await readOwnAiMessages(
      { from: () => builder } as unknown as SupabaseClient,
      ACTOR,
      CONVERSATION,
    );
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.messages.map((item) => item.bodyText)).toEqual(["내 질문"]);
    }
  });
});

describe("회원 AI 요청 경계", () => {
  it("다른 회원 식별자가 있는 질문 본문과 도구 호출을 거절한다", async () => {
    expect(
      aiChatRequestSchema.safeParse({
        clientMessageId: CLIENT_MESSAGE,
        question: "내 대화를 보여 주세요",
        userId: OTHER,
      }).success,
    ).toBe(false);
    expect(
      aiMemberFeedbackSchema.safeParse({
        conversationId: CONVERSATION,
        messageId: MESSAGE,
        rating: "UP",
        reasonCode: "OTHER",
        userId: OTHER,
      }).success,
    ).toBe(false);
    expect(
      aiMemberFeedbackSchema.safeParse({
        conversationId: CONVERSATION,
        messageId: MESSAGE,
        rating: "DOWN",
        reasonCode: "INCORRECT",
      }).success,
    ).toBe(true);
    const from = vi.fn();
    const result = await executeAiTool(
      { from } as unknown as SupabaseClient,
      "wallet.summary",
      { userId: OTHER } as never,
    );
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(result.answer).not.toMatch(/\d/);
  });

  it("제공자에는 이번 질문만 보내고 이전 대화를 붙이지 않는다", () => {
    const body = buildMemberProviderRequestBody({
      instructions: "한국어로 답하세요.",
      maxOutputTokens: 100,
      model: "low-cost",
      question: "채굴은 앱을 닫아도 이어지나요",
    });
    expect(buildMemberProviderRequestBody).toHaveLength(1);
    expect(body.input).toHaveLength(1);
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty("messages");
    expect(JSON.stringify(body.input)).toBe(
      JSON.stringify([
        {
          content: [
            { text: "채굴은 앱을 닫아도 이어지나요", type: "input_text" },
          ],
          role: "user",
        },
      ]),
    );
  });
});
