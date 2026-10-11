import "server-only";
import { redactMemberTranscript } from "@/domain/ai/member-transcript";
import type { ProviderHistoryMessage } from "./provider-history";
import {
  assertOpenRouterModelProof,
  NVIDIA_MODELS,
  type OpenRouterModelProof,
} from "./provider-models";

/** Legacy OpenAI envelope is retained for offline contract tests only. The real
 * member route dispatches the owner-approved NVIDIA -> OpenRouter chain. */
export function buildMemberProviderRequestBody(input: {
  instructions: string;
  maxOutputTokens: number;
  model: string;
  question: string;
  provider?: "nvidia" | "openrouter";
  history?: readonly ProviderHistoryMessage[];
  modelProof?: OpenRouterModelProof;
  nowMs?: number;
}) {
  if (input.provider) {
    if (
      !Number.isSafeInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 1 ||
      input.maxOutputTokens > 4096
    )
      throw new Error("AI_PROVIDER_OUTPUT_BOUND_INVALID");
    const messages = [
      { role: "system" as const, content: input.instructions },
      ...(input.history ?? []).map((message) => ({
        role: message.role,
        content: redactMemberTranscript(message.content),
      })),
      {
        role: "user" as const,
        content: redactMemberTranscript(input.question),
      },
    ];
    if (input.provider === "nvidia") {
      if (!NVIDIA_MODELS.some((model) => model === input.model))
        throw new Error("NVIDIA_MODEL_NOT_APPROVED");
      return {
        model: input.model,
        messages,
        max_tokens: input.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...(input.model === NVIDIA_MODELS[0]
          ? { reasoning_effort: "low" }
          : {}),
      };
    }
    if (!input.modelProof || input.nowMs === undefined)
      throw new Error("OPENROUTER_MODEL_PROOF_INVALID");
    assertOpenRouterModelProof(input.modelProof, input.nowMs);
    if (input.modelProof.model !== input.model)
      throw new Error("OPENROUTER_MODEL_PROOF_INVALID");
    return {
      model: input.model,
      messages,
      max_tokens: input.maxOutputTokens,
      stream: true,
      usage: { include: true },
      provider: {
        only: [input.modelProof.endpointTag],
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
      },
    };
  }
  return {
    input: [
      {
        content: [{ text: input.question, type: "input_text" as const }],
        role: "user" as const,
      },
    ],
    instructions: input.instructions,
    max_output_tokens: input.maxOutputTokens,
    model: input.model,
    store: false as const,
    stream: true as const,
  };
}
