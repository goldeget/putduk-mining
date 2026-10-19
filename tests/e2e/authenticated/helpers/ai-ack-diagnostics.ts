export type AiTransportFailureCategory =
  | "ABORTED"
  | "CONNECTION_RESET"
  | "TARGET_CLOSED"
  | "PROTOCOL_ERROR"
  | "TIMEOUT"
  | "OTHER";

/** Never return an arbitrary browser error, which can embed URLs or credentials. */
export function classifyAiTransportFailure(
  failure: unknown,
): AiTransportFailureCategory {
  const message =
    typeof failure === "string"
      ? failure
      : failure instanceof Error
        ? failure.message
        : "";
  const name = failure instanceof Error ? failure.name : "";
  if (name === "AbortError" || message.includes("net::ERR_ABORTED"))
    return "ABORTED";
  if (message.includes("net::ERR_CONNECTION_RESET")) return "CONNECTION_RESET";
  if (/Target (?:page|context|browser).*closed/i.test(message))
    return "TARGET_CLOSED";
  if (message.includes("Protocol error")) return "PROTOCOL_ERROR";
  if (name === "TimeoutError" || message.includes("net::ERR_TIMED_OUT"))
    return "TIMEOUT";
  return "OTHER";
}

/** Preserve the existing ACK contract and bound; raw body/error never escapes. */
export async function readAiAnswerAck(
  status: number,
  readBody: () => Promise<string>,
) {
  const ack = {
    status,
    bodyAvailable: false,
    doneCount: 0,
    doneSaved: false,
    conversationIdPresent: false,
    assistantMessageIdPresent: false,
  };
  let text: string;
  try {
    text = await readBody();
  } catch (failure) {
    return {
      ack,
      body: {
        outcome: "READ_ERROR" as const,
        failureCategory: classifyAiTransportFailure(failure),
      },
    };
  }
  if (text.length > 65_536)
    return {
      ack,
      body: { outcome: "OVERSIZE" as const, failureCategory: null },
    };
  ack.bodyAvailable = true;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let value: unknown;
    try {
      value = JSON.parse(line.slice(5));
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const event = value as Record<string, unknown>;
    if (event.type !== "done") continue;
    ack.doneCount += 1;
    ack.doneSaved = event.saved === true;
    ack.conversationIdPresent = typeof event.conversationId === "string";
    ack.assistantMessageIdPresent =
      typeof event.assistantMessageId === "string";
  }
  return {
    ack,
    body: { outcome: "READ" as const, failureCategory: null },
  };
}
