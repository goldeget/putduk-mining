import "server-only";

import { nanoUsdToMicroCeiling, parseUsdNano } from "./provider-models";

export type ProviderCompletion = {
  kind: "completed";
  model: string;
  providerRequestId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicroUsd: bigint | null;
  costNanoUsd: bigint | null;
  upstreamProvider: string | null;
};
export type ProviderStreamEvent =
  | ProviderCompletion
  | { kind: "delta"; text: string }
  | { kind: "ignored" }
  | { kind: "failed"; code: string };

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** A stop marker alone is never evidence of tokens, billing or a completed answer.
 * Reasoning fields are deliberately ignored; tools/multimodal output is rejected. */
export function createProviderStreamParser(input: {
  model: string;
  provider: "nvidia" | "openrouter";
  tier: "trial" | "free" | "paid";
  providerName?: string;
  reservedCostMicroUsd?: bigint;
}) {
  let id: string | null = null;
  let provider: string | null = null;
  let tokens: { input: number; output: number; cached: number } | null = null;
  let cost: bigint | null = null;
  let costNano: bigint | null = null;
  let stopped = false,
    terminal = false,
    hasText = false;
  const fail = (code: string): ProviderStreamEvent => {
    terminal = true;
    return { kind: "failed", code };
  };
  return (data: string): ProviderStreamEvent => {
    if (terminal) return { kind: "ignored" };
    if (data === "[DONE]") {
      terminal = true;
      if (!stopped || !hasText || !tokens || !id)
        return { kind: "failed", code: "PROVIDER_COMPLETION_UNVERIFIED" };
      if (
        input.provider === "openrouter" &&
        (provider !== input.providerName ||
          cost === null ||
          (input.tier === "paid" &&
            (input.reservedCostMicroUsd === undefined ||
              cost > input.reservedCostMicroUsd)))
      )
        return { kind: "failed", code: "PROVIDER_BILLING_UNVERIFIED" };
      return {
        kind: "completed",
        model: input.model,
        providerRequestId: id,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cachedInputTokens: tokens.cached,
        costMicroUsd: cost,
        costNanoUsd: costNano,
        upstreamProvider: provider,
      };
    }
    let chunk: Record<string, unknown> | null;
    try {
      chunk = object(JSON.parse(data));
    } catch {
      return fail("PROVIDER_EVENT_INVALID");
    }
    if (!chunk || chunk.error) return fail("PROVIDER_STREAM_FAILED");
    if (chunk.model !== undefined && chunk.model !== input.model)
      return fail("PROVIDER_MODEL_MISMATCH");
    if (chunk.id !== undefined) {
      if (
        typeof chunk.id !== "string" ||
        !/^[\w:./-]{1,200}$/.test(chunk.id) ||
        (id !== null && id !== chunk.id)
      )
        return fail("PROVIDER_REQUEST_MISMATCH");
      id = chunk.id;
    }
    if (chunk.provider !== undefined) {
      if (
        typeof chunk.provider !== "string" ||
        (provider !== null && provider !== chunk.provider) ||
        (input.providerName && chunk.provider !== input.providerName)
      )
        return fail("PROVIDER_IDENTITY_MISMATCH");
      provider = chunk.provider;
    }
    const usage = object(chunk.usage);
    if (chunk.usage !== null && chunk.usage !== undefined && !usage)
      return fail("PROVIDER_USAGE_INVALID");
    if (usage) {
      if (!integer(usage.prompt_tokens) || !integer(usage.completion_tokens))
        return fail("PROVIDER_USAGE_INVALID");
      const details = object(usage.prompt_tokens_details);
      const cached = details?.cached_tokens ?? 0;
      if (
        !integer(cached) ||
        cached > usage.prompt_tokens ||
        (usage.total_tokens !== undefined &&
          (!integer(usage.total_tokens) ||
            usage.total_tokens !==
              usage.prompt_tokens + usage.completion_tokens))
      )
        return fail("PROVIDER_USAGE_INVALID");
      const next = {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        cached,
      };
      if (tokens && JSON.stringify(tokens) !== JSON.stringify(next))
        return fail("PROVIDER_USAGE_CONFLICT");
      tokens = next;
      if (usage.cost !== undefined) {
        const nano = parseUsdNano(usage.cost);
        if (nano === null) return fail("PROVIDER_COST_INVALID");
        const nextCost = nanoUsdToMicroCeiling(nano);
        if (
          (costNano !== null && costNano !== nano) ||
          (input.tier === "free" && nextCost !== 0n)
        )
          return fail("PROVIDER_COST_INVALID");
        cost = nextCost;
        costNano = nano;
      }
    }
    if (!Array.isArray(chunk.choices)) return fail("PROVIDER_EVENT_INVALID");
    if (chunk.choices.length > 1)
      return fail("PROVIDER_MULTIPLE_CHOICES_REJECTED");
    const choice = object(chunk.choices[0]);
    if (!choice)
      return chunk.choices.length === 0
        ? { kind: "ignored" }
        : fail("PROVIDER_EVENT_INVALID");
    if (choice.index !== 0) return fail("PROVIDER_EVENT_INVALID");
    const delta = object(choice.delta);
    if (
      !delta ||
      delta.tool_calls ||
      delta.function_call ||
      delta.images ||
      delta.audio ||
      (delta.role !== undefined && delta.role !== "assistant")
    )
      return fail("PROVIDER_NON_TEXT_REJECTED");
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      if (choice.finish_reason !== "stop")
        return fail("PROVIDER_FINISH_REJECTED");
      stopped = true;
    }
    if (
      delta.content === undefined ||
      delta.content === null ||
      delta.content === ""
    )
      return { kind: "ignored" };
    if (
      typeof delta.content !== "string" ||
      (stopped && choice.finish_reason !== "stop")
    )
      return fail("PROVIDER_NON_TEXT_REJECTED");
    hasText = true;
    return { kind: "delta", text: delta.content };
  };
}

/** Stateful framing preserves split CR/LF and split UTF-8; memory stays bounded. */
export function createProviderSseDecoder() {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  return (bytes?: Uint8Array, final = false) => {
    buffer += decoder.decode(bytes, { stream: !final });
    const events: string[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match) break;
      const block = buffer.slice(0, match.index);
      if (block.length > 64_000) throw new Error("PROVIDER_FRAME_TOO_LARGE");
      buffer = buffer.slice(match.index + match[0].length);
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) events.push(data);
    }
    if (buffer.length > 64_000) throw new Error("PROVIDER_FRAME_TOO_LARGE");
    if (final && buffer.trim()) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) events.push(data);
      buffer = "";
    }
    return events;
  };
}
