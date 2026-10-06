import type { SupabaseClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  conversationTitle,
  redactMemberTranscript,
  sanitizeKnowledgeVersion,
  sanitizeSourceKey,
} from "@/domain/ai/member-transcript";
import {
  appendOwnMemberTurn,
  createSupabaseMemberConversationPort,
  type MemberTurnDraft,
} from "@/lib/ai/member-conversation";

type Row = Record<string, unknown>;
type TableName =
  | "ai_conversations"
  | "ai_messages"
  | "ai_answer_sources"
  | "ai_tool_calls"
  | "ai_feedback";
type Result = { data: Row[] | null; error: { code: string } | null };

// Unit-test transport double: executes the production Supabase adapter, not a
// copied implementation of appendOwnMemberTurn. Not a PostgreSQL/RLS test.
function storage() {
  const tables: Record<TableName, Row[]> = {
    ai_conversations: [],
    ai_messages: [],
    ai_answer_sources: [],
    ai_tool_calls: [],
    ai_feedback: [],
  };
  const failures = new Map<string, number>();
  let sequence = 0;
  let touches = 0;
  function from(table: TableName) {
    const filters: Array<(row: Row) => boolean> = [];
    let operation = "select";
    let value: Row = {};
    let column = "position";
    let ascending = true;
    let maximum = Infinity;
    let execution: Promise<Result> | undefined;
    function run(): Promise<Result> {
      if (execution) return execution;
      execution = Promise.resolve().then(() => {
        const failure = `${table}:${operation}`;
        if ((failures.get(failure) ?? 0) > 0) {
          failures.set(failure, (failures.get(failure) ?? 0) - 1);
          return { data: null, error: { code: "08006" } };
        }
        const rows = tables[table];
        if (!rows) throw new Error("Unexpected table");
        if (operation === "insert") {
          const duplicate = rows.some((row) =>
            table === "ai_messages"
              ? (row.conversation_id === value.conversation_id &&
                  row.position === value.position) ||
                (value.client_message_id != null &&
                  row.user_id === value.user_id &&
                  row.client_message_id === value.client_message_id)
              : row.message_id === value.message_id &&
                row.position === value.position,
          );
          if (table !== "ai_conversations" && duplicate) {
            return { data: null, error: { code: "23505" } };
          }
          if (
            table === "ai_messages" &&
            !tables.ai_conversations.some(
              (row) =>
                row.id === value.conversation_id &&
                row.user_id === value.user_id,
            )
          ) {
            return { data: null, error: { code: "23503" } };
          }
          if (table === "ai_tool_calls" || table === "ai_answer_sources") {
            if (
              !tables.ai_messages.some(
                (row) =>
                  row.id === value.message_id &&
                  row.user_id === value.user_id &&
                  row.conversation_id === value.conversation_id &&
                  row.author_role === "ASSISTANT",
              )
            ) {
              return { data: null, error: { code: "23503" } };
            }
          }
          const row = {
            client_message_id: null,
            ...value,
            id: `row-${++sequence}`,
          };
          rows.push(row);
          return { data: [row], error: null };
        }
        let selected = rows.filter((row) =>
          filters.every((filter) => filter(row)),
        );
        if (operation === "update") {
          assert.equal(
            table,
            "ai_conversations",
            "Evidence must be append-only",
          );
          selected.forEach((row) => Object.assign(row, value));
          touches += selected.length;
        }
        selected = [...selected]
          .sort((a, b) => {
            const left = a[column] as number;
            const right = b[column] as number;
            return ascending ? left - right : right - left;
          })
          .slice(0, maximum);
        return { data: selected, error: null };
      });
      return execution;
    }
    const builder = {
      select() {
        return builder;
      },
      insert(row: Row) {
        operation = "insert";
        value = row;
        return builder;
      },
      update(row: Row) {
        operation = "update";
        value = row;
        return builder;
      },
      eq(key: string, item: unknown) {
        filters.push((row) => row[key] === item);
        return builder;
      },
      gt(key: string, item: number) {
        filters.push((row) => Number(row[key]) > item);
        return builder;
      },
      gte(key: string, item: number) {
        filters.push((row) => Number(row[key]) >= item);
        return builder;
      },
      order(key: string, options: { ascending: boolean }) {
        column = key;
        ascending = options.ascending;
        return builder;
      },
      limit(count: number) {
        maximum = count;
        return builder;
      },
      async maybeSingle() {
        const result = await run();
        return { ...result, data: result.data?.[0] ?? null };
      },
      async single() {
        return builder.maybeSingle();
      },
      then(
        resolve: (result: Result) => unknown,
        reject?: (error: unknown) => unknown,
      ) {
        return run().then(resolve, reject);
      },
    };
    return builder;
  }
  return {
    tables,
    failures,
    port: createSupabaseMemberConversationPort({
      from,
    } as unknown as SupabaseClient),
    touches: () => touches,
  };
}

const draft: MemberTurnDraft = {
  userId: "member-a",
  clientMessageId: "request-a",
  question: "홈 화면 안내",
  answer: "홈에서 내 상태를 확인해 주세요.",
  sourceKey: "guide:home",
  knowledgeVersion: "2026.10",
  toolCall: { toolName: "wallet.summary", outcome: "SUCCEEDED", latencyMs: 12 },
};

describe("합성 비밀정보의 완전한 값 가림", () => {
  const cases = [
    ["otp: 1234", "1234"],
    ["otp: 123456", "123456"],
    ["인증번호: 1234", "1234"],
    ["PIN=0987", "0987"],
    ["otp 1234", "1234"],
    ["pin 0987", "0987"],
    ['password: "alpha beta gamma"', "alpha beta gamma"],
    ['password: "winter garden maple"', "winter garden maple"],
    ['password: "a b"', "a b"],
    ['password: "가 나 다"', "가 나 다"],
    ["비밀번호는 ‘alpha beta gamma’", "alpha beta gamma"],
    ["비밀번호는 “winter garden maple”", "winter garden maple"],
    ["비밀번호 「alpha beta gamma」", "alpha beta gamma"],
    ["비밀번호 『alpha beta gamma』", "alpha beta gamma"],
    ['"password": "alpha beta gamma"', "alpha beta gamma"],
    ['password: "winter \\"garden\\" maple"', "maple"],
    ['password: "alpha\nbeta\ngamma"', "gamma"],
    ['password: "alpha beta gamma', "gamma"],
    ["password: alpha beta gamma", "gamma"],
    ["api key: xy", "xy"],
    ["토큰은 'xy'", "xy"],
    ["recovery code: 12", "12"],
    [
      "시드 문구 abandon ability able about above absent absorb abstract absurd abuse access accident",
      "accident",
    ],
    ["Bearer synthetic-secret-token", "synthetic-secret-token"],
  ] as const;
  for (const [index, [input, secret]] of cases.entries()) {
    it(`가림 사례 ${index + 1}`, () => {
      const result = redactMemberTranscript(input);
      assert.ok(!result.includes(secret));
      assert.ok(result.includes("[가림]"));
      assert.equal(redactMemberTranscript(result), result);
      assert.ok(!conversationTitle(result).includes(secret));
      assert.ok(!sanitizeSourceKey(input).includes(secret));
      assert.equal(sanitizeKnowledgeVersion(input), null);
    });
  }
  for (const query of [
    "오늘 채굴은 어떻게 보나요?",
    "비밀번호는 무엇인가요",
    "비밀번호 변경은 어디서 하나요?",
    "홈 화면 안내",
    "tokenization is a word",
    "passwordless login",
    "pinning packages",
  ]) {
    it(`일반 문장 보존: ${query}`, () => {
      assert.equal(redactMemberTranscript(query), query);
    });
  }
  it("서로 다른 따옴표와 뒤의 일반 문장을 구분한다", () => {
    assert.equal(
      redactMemberTranscript('password: "alpha beta gamma" 홈 안내'),
      "[가림] 홈 안내",
    );
    assert.equal(
      redactMemberTranscript('password: "a b" otp: "1234"'),
      "[가림] [가림]",
    );
  });
});

describe("동일 턴의 답변 근거 복구", () => {
  for (const table of [
    "ai_answer_sources",
    "ai_tool_calls",
    "ai_conversations",
  ]) {
    it(`${table} 저장 실패 뒤 누락된 기록을 복구한다`, async () => {
      const memory = storage();
      memory.failures.set(
        `${table}:${table === "ai_conversations" ? "update" : "insert"}`,
        1,
      );
      assert.equal((await appendOwnMemberTurn(memory.port, draft)).ok, false);
      const recovered = await appendOwnMemberTurn(memory.port, draft);
      assert.equal(recovered.ok, true);
      assert.equal(memory.tables.ai_messages.length, 2);
      assert.equal(memory.tables.ai_tool_calls.length, 1);
      assert.equal(memory.tables.ai_answer_sources.length, 1);
      assert.equal(memory.touches(), 1);
      assert.deepEqual(
        await appendOwnMemberTurn(memory.port, draft),
        recovered,
      );
      assert.equal(memory.tables.ai_answer_sources.length, 1);
      assert.equal(memory.tables.ai_tool_calls.length, 1);
    });
  }
  it("계속 실패하면 계속 미저장으로 반환한다", async () => {
    const memory = storage();
    memory.failures.set("ai_answer_sources:insert", 3);
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await appendOwnMemberTurn(memory.port, draft)).ok, false);
    }
    assert.equal(memory.tables.ai_messages.length, 2);
    assert.equal(memory.tables.ai_answer_sources.length, 0);
  });
  for (const change of [
    { answer: "바뀐 답변" },
    { question: "바뀐 질문" },
    { sourceKey: "guide:different" },
    { knowledgeVersion: "different" },
    { toolCall: { ...draft.toolCall!, outcome: "FAILED" as const } },
  ]) {
    it(`동일 키의 다른 본문·근거를 덮어쓰지 않는다: ${Object.keys(change)[0]}`, async () => {
      const memory = storage();
      assert.equal((await appendOwnMemberTurn(memory.port, draft)).ok, true);
      const before = JSON.stringify(memory.tables);
      assert.equal(
        (await appendOwnMemberTurn(memory.port, { ...draft, ...change })).ok,
        false,
      );
      assert.equal(JSON.stringify(memory.tables), before);
    });
  }
  it("다른 회원 대화로 복구하거나 추가하지 않는다", async () => {
    const memory = storage();
    const first = await appendOwnMemberTurn(memory.port, draft);
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("Expected successful setup");
    const result = await appendOwnMemberTurn(memory.port, {
      ...draft,
      userId: "member-b",
      conversationId: first.conversationId,
    });
    assert.deepEqual(result, { code: "NOT_OWN_CONVERSATION", ok: false });
    assert.equal(memory.tables.ai_messages.length, 2);
  });
  it("근거 충돌의 조회까지 실패하면 성공으로 처리하지 않는다", async () => {
    const memory = storage();
    await appendOwnMemberTurn(memory.port, draft);
    memory.failures.set("ai_answer_sources:select", 1);
    assert.equal((await appendOwnMemberTurn(memory.port, draft)).ok, false);
  });
  it("부분 답변을 완료로 보고하거나 답변을 중복 추가하지 않는다", async () => {
    const memory = storage();
    const long = { ...draft, answer: "가".repeat(8_001) };
    await appendOwnMemberTurn(memory.port, long);
    memory.tables.ai_messages.pop(); // Simulate an interrupted chunk write.
    assert.equal((await appendOwnMemberTurn(memory.port, long)).ok, false);
    assert.equal(memory.tables.ai_messages.length, 2);
  });
  it("다음 질문을 이전 질문의 답변으로 잘못 연결하지 않는다", async () => {
    const memory = storage();
    await appendOwnMemberTurn(memory.port, draft);
    const answer = memory.tables.ai_messages[1];
    assert.ok(answer, "Expected stored answer");
    answer.author_role = "MEMBER";
    assert.equal((await appendOwnMemberTurn(memory.port, draft)).ok, false);
    assert.equal(memory.tables.ai_messages.length, 2);
  });
  it("동시 근거 복구도 같은 행만 한 번 남긴다", async () => {
    const memory = storage();
    memory.failures.set("ai_answer_sources:insert", 1);
    await appendOwnMemberTurn(memory.port, draft);
    const results = await Promise.all([
      appendOwnMemberTurn(memory.port, draft),
      appendOwnMemberTurn(memory.port, draft),
    ]);
    assert.ok(results.every((result) => result.ok));
    assert.equal(memory.tables.ai_answer_sources.length, 1);
    assert.equal(memory.tables.ai_tool_calls.length, 1);
    assert.equal(memory.tables.ai_messages.length, 2);
  });
});
