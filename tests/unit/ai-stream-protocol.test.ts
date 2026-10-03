import { describe, expect, it } from "vitest";

import {
  aiFailure,
  applyAiStreamEvent,
  createAiEventDecoder,
  readAiHttpFailure,
  PutdukAiProtocolError,
  type PutdukAiMessage,
} from "@/components/product/putduk-ai-protocol";

const requestId = "a3cb8f7b-16b6-41c8-8f65-5782e6b14df7";
const encode = (value: object) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const start = (): PutdukAiMessage => ({
  id: "assistant",
  role: "assistant",
  state: "streaming",
  text: "",
});

describe("the actual PUTDUK AI public stream protocol", () => {
  it("decodes split Korean UTF-8, split CRLF, comments, and a final block without a delimiter", () => {
    const decoder = createAiEventDecoder();
    const bytes = new TextEncoder().encode(
      `: keepalive\r\n\r\n${encode({ type: "ready", requestId, source: "static" })}${encode({ type: "delta", text: "확인한 안내예요." })}data: ${JSON.stringify({ type: "done", requestId, knowledgeVersion: "v1" })}`,
    );
    const events = Array.from(bytes).flatMap((byte) =>
      decoder.push(Uint8Array.of(byte)),
    );
    events.push(...decoder.push(undefined, true));
    const message = events.reduce(applyAiStreamEvent, start());
    expect(message).toMatchObject({
      state: "complete",
      source: "static",
      requestId,
      knowledgeVersion: "v1",
      text: "확인한 안내예요.",
    });
    expect(message.grounding).toBeUndefined();
  });

  it("keeps owned tool provenance only after matching completion", () => {
    let message = applyAiStreamEvent(start(), {
      type: "ready",
      requestId,
      source: "tool",
    });
    message = applyAiStreamEvent(message, {
      type: "delta",
      text: "확정 기록을 확인했어요.",
    });
    expect(message.grounding).toBeUndefined();
    const grounding = {
      asOf: "2026-10-03T02:00:00.000Z",
      source: "domain_tool" as const,
      tool: "wallet.summary",
    };
    expect(
      applyAiStreamEvent(message, {
        type: "done",
        requestId,
        knowledgeVersion: "v1",
        grounding,
      }),
    ).toMatchObject({ state: "complete", source: "tool", grounding });
    expect(() =>
      applyAiStreamEvent(message, {
        type: "done",
        requestId,
        knowledgeVersion: "v1",
      }),
    ).toThrow(PutdukAiProtocolError);
  });

  it("rejects a mismatched receipt, fabricated grounding, a delta before ready and empty completion", () => {
    const ready = applyAiStreamEvent(start(), {
      type: "ready",
      requestId,
      source: "provider",
    });
    const partial = applyAiStreamEvent(ready, {
      type: "delta",
      text: "일반 도움말이에요.",
    });
    expect(() =>
      applyAiStreamEvent(start(), { type: "delta", text: "순서가 틀림" }),
    ).toThrow(PutdukAiProtocolError);
    expect(() =>
      applyAiStreamEvent(ready, {
        type: "done",
        requestId,
        knowledgeVersion: "v1",
      }),
    ).toThrow(PutdukAiProtocolError);
    expect(() =>
      applyAiStreamEvent(partial, {
        type: "done",
        requestId: "10e45188-3c3a-4388-9c8c-f3843254cabe",
        knowledgeVersion: "v1",
      }),
    ).toThrow(PutdukAiProtocolError);
    expect(() =>
      applyAiStreamEvent(partial, {
        type: "done",
        requestId,
        knowledgeVersion: "v1",
        grounding: {
          asOf: "2026-10-03T02:00:00Z",
          source: "domain_tool",
          tool: "wallet.summary",
        },
      }),
    ).toThrow(PutdukAiProtocolError);
  });

  it("rejects malformed known events and invalid grounding instead of inventing completion", () => {
    for (const event of [
      {
        type: "done",
        requestId,
        knowledgeVersion: "v1",
        grounding: {
          asOf: "not-a-date",
          source: "domain_tool",
          tool: "wallet.summary",
        },
      },
      { type: "ready", requestId, source: "admin" },
      { type: "delta", text: 5000 },
      { type: "done", requestId, knowledgeVersion: "v1", userId: "forged" },
    ]) {
      expect(() =>
        createAiEventDecoder().push(new TextEncoder().encode(encode(event))),
      ).toThrow(PutdukAiProtocolError);
    }
    expect(() =>
      createAiEventDecoder().push(
        new TextEncoder().encode("data: {broken}\n\n"),
      ),
    ).toThrow(PutdukAiProtocolError);
  });

  it("ignores unknown internal event types and enforces a bounded total answer", () => {
    expect(
      createAiEventDecoder().push(
        new TextEncoder().encode(
          encode({ type: "reasoning", text: "internal" }),
        ),
      ),
    ).toEqual([]);
    const message = {
      ...applyAiStreamEvent(start(), {
        type: "ready",
        requestId,
        source: "provider",
      }),
      text: "a".repeat(32_000),
    };
    expect(() =>
      applyAiStreamEvent(message, { type: "delta", text: "a" }),
    ).toThrow(PutdukAiProtocolError);
    expect(() =>
      createAiEventDecoder().push(
        new TextEncoder().encode("data: " + "a".repeat(64_000)),
      ),
    ).toThrow(PutdukAiProtocolError);
  });

  it("accepts many complete small frames arriving in one large network chunk", () => {
    const text = Array.from({ length: 3000 }, () =>
      encode({ type: "delta", text: "a" }),
    ).join("");
    expect(
      createAiEventDecoder().push(new TextEncoder().encode(text)),
    ).toHaveLength(3000);
  });

  it("distinguishes unavailable owned data, provider failure, login, limits, and actual connectivity", () => {
    expect(aiFailure("AI_TOOL_UNAVAILABLE").label).toBe("상태 확인 실패");
    expect(aiFailure("AI_CONNECTION_FAILED").label).toBe("연결 실패");
    expect(aiFailure("AI_PROVIDER_UNAVAILABLE").label).toBe("AI 응답 불가");
    expect(readAiHttpFailure(null, 401).label).toBe("로그인 필요");
    expect(readAiHttpFailure(null, 429).label).toBe("요청 제한");
    const message = applyAiStreamEvent(
      applyAiStreamEvent(start(), { type: "ready", requestId, source: "tool" }),
      {
        type: "error",
        code: "AI_TOOL_UNAVAILABLE",
        message: "잔액을 확인하지 못했어요.",
      },
    );
    expect(message).toMatchObject({
      state: "error",
      source: "tool",
      failure: {
        label: "상태 확인 실패",
        message: "잔액을 확인하지 못했어요.",
      },
    });
    expect(message.text).toBe("");
    expect(message.grounding).toBeUndefined();
  });

  it("preserves the account-change error code separately from connectivity and ordinary HTTP conflicts", () => {
    expect(
      readAiHttpFailure(
        {
          error: {
            code: "AI_SESSION_CHANGED",
            message: "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
          },
        },
        409,
      ),
    ).toEqual({
      code: "AI_SESSION_CHANGED",
      label: "로그인 상태 확인",
      message: "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
    });
    expect(aiFailure("AI_SESSION_CHANGED").label).not.toBe(
      aiFailure("AI_CONNECTION_FAILED").label,
    );
    expect(readAiHttpFailure(null, 409).code).toBe("AI_HTTP_ERROR");
    expect(
      readAiHttpFailure({ error: { code: "AI_REQUEST_ALREADY_EXISTS" } }, 409)
        .code,
    ).toBe("AI_REQUEST_ALREADY_EXISTS");
  });
});
