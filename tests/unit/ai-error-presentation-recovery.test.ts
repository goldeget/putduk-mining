import { describe, expect, it } from "vitest";

import {
  aiFailure,
  applyAiStreamEvent,
  createAiEventDecoder,
  readAiHttpFailure,
  type PutdukAiMessage,
} from "@/components/product/putduk-ai-protocol";

const uuid = (id: number) =>
  `ab125100-0000-4000-8000-${String(id).padStart(12, "0")}`;
const technicalMessage = `SQL permission denied service_role admin.mining.putduk.com ${uuid(99)}`;

describe("AI HTTP and SSE failure presentation boundary", () => {
  it.each([
    "AI_TOOL_UNAVAILABLE",
    "AI_TIMEOUT",
    "AI_OUTPUT_POLICY_REJECTED",
    "CLIENT_CANCELLED",
    "UNKNOWN_SQL_FAILURE",
  ])("does not display forged technical messages for %s", (code) => {
    const failure = aiFailure(code, technicalMessage);
    expect(failure.message).not.toContain(technicalMessage);
    expect(failure.message).not.toMatch(
      /service_role|SQL|admin\.|[a-f0-9]{8}-[a-f0-9-]{27}/,
    );
    expect(failure.label).not.toBe(code);
  });

  it("accepts only exact reviewed tool-failure sentences for the correct code", () => {
    const safe = "잔액을 확인하지 못했어요.";
    expect(aiFailure("AI_TOOL_UNAVAILABLE", safe).message).toBe(safe);
    expect(aiFailure("AI_TIMEOUT", safe).message).not.toBe(safe);
    expect(
      aiFailure("AI_TOOL_UNAVAILABLE", `${safe} ${technicalMessage}`).message,
    ).not.toContain(technicalMessage);
    expect(
      aiFailure(
        "AI_TOOL_UNAVAILABLE",
        "내 계좌는 123456789이고 잔액은 999원입니다.",
      ).message,
    ).not.toContain("999원");
  });

  it("checks HTTP code/status pairs without echoing error payloads", () => {
    expect(
      readAiHttpFailure(
        { error: { code: "AI_SESSION_CHANGED", message: technicalMessage } },
        409,
      ).label,
    ).toBe("로그인 상태 확인");
    expect(
      readAiHttpFailure(
        { error: { code: "AI_SESSION_CHANGED", message: technicalMessage } },
        503,
      ).code,
    ).toBe("AI_HTTP_ERROR");
    expect(
      readAiHttpFailure(
        { error: { code: "constructor", message: technicalMessage } },
        409,
      ).code,
    ).toBe("AI_HTTP_ERROR");
    expect(
      readAiHttpFailure(
        { error: { code: "AI_SESSION_CHANGED", message: {} } },
        409,
      ).code,
    ).toBe("AI_HTTP_ERROR");
    expect(
      readAiHttpFailure(
        { error: { code: "PAYLOAD_TOO_LARGE", message: technicalMessage } },
        413,
      ).message,
    ).toContain("질문을 짧게");
  });

  it("preserves partial answer/history while sanitizing the actual decoded SSE error", () => {
    let answer: PutdukAiMessage = {
      id: "assistant",
      role: "assistant",
      state: "streaming",
      text: "",
    };
    const frames = [
      { type: "ready", requestId: uuid(5), source: "tool" },
      { type: "delta", text: "이미 받은 본인의 안내입니다." },
      {
        type: "error",
        code: "AI_TOOL_UNAVAILABLE",
        message: technicalMessage,
        saved: false,
        conversationId: uuid(6),
      },
    ];
    const encoded = frames
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join("");
    for (const event of createAiEventDecoder().push(
      new TextEncoder().encode(encoded),
    ))
      answer = applyAiStreamEvent(answer, event);
    expect(answer).toMatchObject({
      state: "error",
      text: "이미 받은 본인의 안내입니다.",
      source: "tool",
      requestId: uuid(5),
      saved: false,
      conversationId: uuid(6),
    });
    expect(answer.grounding).toBeUndefined();
    expect(answer.failure?.label).toBe("상태 확인 실패");
    expect(answer.failure?.message).not.toContain(technicalMessage);
    expect(aiFailure("AI_STREAM_INTERRUPTED").label).toBe("답변 수신 중단");
    expect(aiFailure("CLIENT_CANCELLED").label).toBe("답변 중단됨");
    expect(aiFailure("AI_SERVICE_NOT_CONFIGURED").label).toBe(
      "서비스 준비 필요",
    );
  });
});
