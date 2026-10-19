import { describe, expect, it } from "vitest";

import {
  classifyAiTransportFailure,
  readAiAnswerAck,
} from "../e2e/authenticated/helpers/ai-ack-diagnostics";

const savedDone =
  'data: {"type":"done","saved":true,"conversationId":"private-conversation","assistantMessageId":"private-message"}\n\n';

describe("AI ACK metadata", () => {
  // Missing parsing must never turn a genuine saved receipt into default false flags.
  it("reads the genuine saved receipt without retaining identifiers or transcript", async () => {
    const response = new Response(
      'data: {"type":"delta","text":"private-answer"}\n\n' + savedDone,
    );
    const result = await readAiAnswerAck(200, () => response.text());
    expect(result).toEqual({
      ack: {
        status: 200,
        bodyAvailable: true,
        doneCount: 1,
        doneSaved: true,
        conversationIdPresent: true,
        assistantMessageIdPresent: true,
      },
      body: { outcome: "READ", failureCategory: null },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-/);
  });

  // A transport rejection and a rejected size bound must stay distinguishable.
  it("classifies an actual rejected body read without copying its error message", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("net::ERR_ABORTED private-token"));
        },
      }),
    );
    const result = await readAiAnswerAck(200, () => response.text());
    expect(result.body).toEqual({
      outcome: "READ_ERROR",
      failureCategory: "ABORTED",
    });
    expect(result.ack).toEqual({
      status: 200,
      bodyAvailable: false,
      doneCount: 0,
      doneSaved: false,
      conversationIdPresent: false,
      assistantMessageIdPresent: false,
    });
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("rejects an oversized readable body before accepting a saved receipt", async () => {
    const result = await readAiAnswerAck(200, () =>
      new Response(savedDone + "x".repeat(65_537)).text(),
    );
    expect(result.body).toEqual({ outcome: "OVERSIZE", failureCategory: null });
    expect(result.ack.bodyAvailable).toBe(false);
    expect(result.ack.doneCount).toBe(0);
    expect(result.ack.doneSaved).toBe(false);
  });

  it("accepts the existing exact size boundary without raising the limit", async () => {
    const body = savedDone + "x".repeat(65_536 - savedDone.length);
    const result = await readAiAnswerAck(200, () => new Response(body).text());
    expect(result.body.outcome).toBe("READ");
    expect(result.ack.bodyAvailable).toBe(true);
    expect(result.ack.doneCount).toBe(1);
  });

  it("preserves duplicate done events and the last saved:false observation", async () => {
    const result = await readAiAnswerAck(200, () =>
      new Response(
        savedDone + 'data: {"type":"done","saved":false}\n\n',
      ).text(),
    );
    expect(result.ack).toEqual({
      status: 200,
      bodyAvailable: true,
      doneCount: 2,
      doneSaved: false,
      conversationIdPresent: false,
      assistantMessageIdPresent: false,
    });
  });

  it("keeps a genuine unsaved receipt distinct from an unreadable body", async () => {
    const result = await readAiAnswerAck(200, () =>
      new Response('data: {"type":"done","saved":false}\n\n').text(),
    );
    expect(result.body.outcome).toBe("READ");
    expect(result.ack.bodyAvailable).toBe(true);
    expect(result.ack.doneCount).toBe(1);
    expect(result.ack.doneSaved).toBe(false);
  });

  it("does not infer a saved ACK from malformed data, arrays, or non-done events", async () => {
    const result = await readAiAnswerAck(503, () =>
      new Response(
        'data: {broken}\ndata: []\ndata: null\ndata: {"type":"delta","saved":true}\n',
      ).text(),
    );
    expect(result.ack).toEqual({
      status: 503,
      bodyAvailable: true,
      doneCount: 0,
      doneSaved: false,
      conversationIdPresent: false,
      assistantMessageIdPresent: false,
    });
  });
});

describe("safe transport failure categories", () => {
  // Unknown errors must not become arbitrary strings in the diagnostic artifact.
  it.each([
    [
      new Error("net::ERR_ABORTED https://private.invalid/?token=secret"),
      "ABORTED",
    ],
    [new DOMException("private reason", "AbortError"), "ABORTED"],
    ["net::ERR_CONNECTION_RESET", "CONNECTION_RESET"],
    [
      new Error("Target page, context or browser has been closed"),
      "TARGET_CLOSED",
    ],
    [new Error("Protocol error: private body unavailable"), "PROTOCOL_ERROR"],
    [new DOMException("private timeout", "TimeoutError"), "TIMEOUT"],
    [new Error("private-token-and-message"), "OTHER"],
    [{ message: "private-value" }, "OTHER"],
    [undefined, "OTHER"],
  ])("emits a finite category for failure fixture %#", (failure, expected) => {
    expect(classifyAiTransportFailure(failure)).toBe(expected);
  });
});
