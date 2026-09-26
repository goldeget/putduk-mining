type OpenAiCompletedEvent = {
  kind: "completed";
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  model: string | null;
  providerRequestId: string | null;
};

export type OpenAiStreamEvent =
  | { kind: "delta"; text: string }
  | OpenAiCompletedEvent
  | { kind: "failed"; code: string }
  | { kind: "done_marker" }
  | { kind: "ignored" };

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function parseOpenAiSseData(data: string): OpenAiStreamEvent {
  if (data === "[DONE]") {
    return { kind: "done_marker" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(data);
  } catch {
    return { kind: "failed", code: "PROVIDER_EVENT_INVALID" };
  }

  const event = objectValue(decoded);
  if (!event || typeof event.type !== "string") {
    return { kind: "ignored" };
  }

  if (
    event.type === "response.output_text.delta" &&
    typeof event.delta === "string"
  ) {
    return { kind: "delta", text: event.delta };
  }

  if (event.type === "response.completed") {
    const response = objectValue(event.response);
    const usage = objectValue(response?.usage);
    const inputDetails = objectValue(usage?.input_tokens_details);

    return {
      kind: "completed",
      cachedInputTokens: nonNegativeInteger(inputDetails?.cached_tokens),
      inputTokens: nonNegativeInteger(usage?.input_tokens),
      model: typeof response?.model === "string" ? response.model : null,
      outputTokens: nonNegativeInteger(usage?.output_tokens),
      providerRequestId: typeof response?.id === "string" ? response.id : null,
    };
  }

  if (
    event.type === "error" ||
    event.type === "response.failed" ||
    event.type === "response.incomplete"
  ) {
    return { kind: "failed", code: "PROVIDER_STREAM_FAILED" };
  }

  return { kind: "ignored" };
}

export function extractSseData(block: string) {
  return block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}
