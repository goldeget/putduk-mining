import "server-only";

export const NVIDIA_MODELS = [
  "openai/gpt-oss-20b",
  "google/diffusiongemma-26b-a4b-it",
] as const;
export const OPENROUTER_FREE_MODEL = "apodex/apodex-1.1-mini:free";
export const OPENROUTER_PAID_MODEL = "anthropic/claude-haiku-5.5";
export const NVIDIA_CHAT_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";
export const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const AI_CUMULATIVE_PAID_CAP_MICRO_USD = 10_000_000n;

export type MemberAiProvider = "nvidia" | "openrouter";
export type ProviderTier = "trial" | "free" | "paid";

/** Decimal/scientific strings are converted with integers, rounded up to nanoUSD. */
export function parseUsdNano(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d{1,20})(?:\.(\d{1,30}))?(?:e([+-]?\d{1,2}))?$/i.exec(
    String(value),
  );
  if (!match) return null;
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? 0);
  if (Math.abs(exponent) > 30) return null;
  const coefficient = BigInt(match[1]! + fraction);
  const shift = 9 + exponent - fraction.length;
  if (shift >= 0) return coefficient * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  return (coefficient + divisor - 1n) / divisor;
}

export function nanoUsdToMicroCeiling(value: bigint) {
  if (value < 0n) throw new Error("AI_COST_INVALID");
  return (value + 999n) / 1000n;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type OpenRouterModelProof = Readonly<{
  model: typeof OPENROUTER_FREE_MODEL | typeof OPENROUTER_PAID_MODEL;
  tier: "free" | "paid";
  providerName: string;
  endpointTag: string;
  verifiedAtMs: number;
  expiresAtMs: number;
  promptPriceNanoUsd: bigint;
  completionPriceNanoUsd: bigint;
  requestPriceNanoUsd: bigint;
}>;
const issuedProofs = new WeakSet<object>();
const MAX_PROOF_AGE_MS = 60 * 60 * 1000;

function readPrices(value: unknown, free: boolean) {
  const prices = record(value);
  if (
    !prices ||
    !Object.hasOwn(prices, "prompt") ||
    !Object.hasOwn(prices, "completion")
  )
    throw new Error("OPENROUTER_PRICING_UNVERIFIED");
  let prompt = 0n,
    completion = 0n,
    request = 0n;
  for (const [name, price] of Object.entries(prices)) {
    if (name === "overrides") continue;
    const amount = parseUsdNano(price);
    if (amount === null || (free && amount !== 0n))
      throw new Error("OPENROUTER_PRICING_UNVERIFIED");
    if (
      [
        "prompt",
        "input_cache_read",
        "input_cache_write",
        "input_cache_write_1h",
      ].includes(name) &&
      amount > prompt
    )
      prompt = amount;
    if (name === "completion") completion = amount;
    if (name === "request") request = amount;
  }
  if (Object.hasOwn(prices, "overrides")) {
    if (!Array.isArray(prices.overrides) || prices.overrides.length > 20)
      throw new Error("OPENROUTER_PRICING_UNVERIFIED");
    for (const raw of prices.overrides) {
      const override = record(raw);
      if (
        !override ||
        !Number.isSafeInteger(override.min_prompt_tokens) ||
        Number(override.min_prompt_tokens) < 0 ||
        Object.hasOwn(override, "overrides")
      )
        throw new Error("OPENROUTER_PRICING_UNVERIFIED");
      const next = readPrices(
        Object.fromEntries(
          Object.entries(override).filter(
            ([key]) => key !== "min_prompt_tokens",
          ),
        ),
        free,
      );
      if (next.prompt > prompt) prompt = next.prompt;
      if (next.completion > completion) completion = next.completion;
      if (next.request > request) request = next.request;
    }
  }
  return { prompt, completion, request };
}

/** Official identity + current exact endpoint + worst-case pricing. A proof is
 * an in-process capability, not a serializable client claim or a paid approval. */
export function verifyOpenRouterModel(input: {
  model: string;
  registry: unknown;
  endpointRegistry: unknown;
  retrievedAtMs: number;
  nowMs: number;
}): OpenRouterModelProof {
  if (
    (input.model !== OPENROUTER_FREE_MODEL &&
      input.model !== OPENROUTER_PAID_MODEL) ||
    !Number.isSafeInteger(input.retrievedAtMs) ||
    !Number.isSafeInteger(input.nowMs) ||
    input.retrievedAtMs > input.nowMs ||
    input.nowMs - input.retrievedAtMs >= MAX_PROOF_AGE_MS
  )
    throw new Error("OPENROUTER_MODEL_PROOF_INVALID");
  const models = record(input.registry)?.data;
  if (!Array.isArray(models)) throw new Error("OPENROUTER_MODEL_UNVERIFIED");
  const matches = models.filter((row) => record(row)?.id === input.model);
  if (matches.length !== 1) throw new Error("OPENROUTER_MODEL_UNVERIFIED");
  const model = record(matches[0])!;
  const architecture = record(model.architecture);
  if (
    !Array.isArray(architecture?.input_modalities) ||
    !architecture.input_modalities.includes("text") ||
    !Array.isArray(architecture.output_modalities) ||
    architecture.output_modalities.length !== 1 ||
    architecture.output_modalities[0] !== "text"
  )
    throw new Error("OPENROUTER_TEXT_MODEL_REQUIRED");
  const free = input.model === OPENROUTER_FREE_MODEL;
  readPrices(model.pricing, free);
  const endpointModel = record(record(input.endpointRegistry)?.data);
  if (
    endpointModel?.id !== input.model ||
    !Array.isArray(endpointModel.endpoints)
  )
    throw new Error("OPENROUTER_ENDPOINT_UNVERIFIED");
  const endpointTag = free ? "novita/bf16" : "anthropic";
  const endpointMatches = endpointModel.endpoints.filter(
    (row) => record(row)?.tag === endpointTag,
  );
  if (endpointMatches.length !== 1)
    throw new Error("OPENROUTER_ENDPOINT_UNVERIFIED");
  const endpoint = record(endpointMatches[0])!;
  const providerName = free ? "Novita" : "Anthropic";
  if (
    endpoint.provider_name !== providerName ||
    endpoint.model_id !== input.model ||
    endpoint.status !== 0 ||
    !Array.isArray(endpoint.supported_parameters) ||
    !endpoint.supported_parameters.includes("max_tokens")
  )
    throw new Error("OPENROUTER_ENDPOINT_UNVERIFIED");
  const prices = readPrices(endpoint.pricing, free);
  if (!free && prices.prompt === 0n && prices.completion === 0n)
    throw new Error("OPENROUTER_PAID_PRICING_UNVERIFIED");
  const proof: OpenRouterModelProof = Object.freeze({
    model: input.model,
    tier: free ? "free" : "paid",
    providerName,
    endpointTag,
    verifiedAtMs: input.retrievedAtMs,
    expiresAtMs: input.retrievedAtMs + MAX_PROOF_AGE_MS,
    promptPriceNanoUsd: prices.prompt,
    completionPriceNanoUsd: prices.completion,
    requestPriceNanoUsd: prices.request,
  });
  issuedProofs.add(proof);
  return proof;
}

export function assertOpenRouterModelProof(
  proof: OpenRouterModelProof,
  nowMs: number,
) {
  if (
    !issuedProofs.has(proof) ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < proof.verifiedAtMs ||
    nowMs >= proof.expiresAtMs
  )
    throw new Error("OPENROUTER_MODEL_PROOF_INVALID");
}

export function estimatePaidReservationMicroUsd(
  proof: OpenRouterModelProof,
  messages: readonly { content: string }[],
  maxOutputTokens: number,
  nowMs: number,
) {
  assertOpenRouterModelProof(proof, nowMs);
  if (
    proof.tier !== "paid" ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 4096
  )
    throw new Error("AI_PAID_INPUT_BOUND_REQUIRED");
  // Each UTF-8 byte is a conservative token bound, plus per-message framing.
  const inputUpperBound = messages.reduce(
    (sum, message) =>
      sum + new TextEncoder().encode(message.content).byteLength + 128,
    128,
  );
  const reserve = nanoUsdToMicroCeiling(
    BigInt(inputUpperBound) * proof.promptPriceNanoUsd +
      BigInt(maxOutputTokens) * proof.completionPriceNanoUsd +
      proof.requestPriceNanoUsd,
  );
  if (reserve <= 0n || reserve > AI_CUMULATIVE_PAID_CAP_MICRO_USD)
    throw new Error("AI_PAID_BUDGET_NOT_ADMITTED");
  return reserve;
}
