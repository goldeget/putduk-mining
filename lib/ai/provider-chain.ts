import "server-only";

import type { ProviderAttemptPort } from "./provider-attempts";
import type { ProviderHistoryMessage } from "./provider-history";
import {
  estimatePaidReservationMicroUsd,
  NVIDIA_CHAT_URL,
  NVIDIA_MODELS,
  OPENROUTER_CHAT_URL,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_PAID_MODEL,
  type OpenRouterModelProof,
} from "./provider-models";
import { readProviderRegistry } from "./provider-registry";
import {
  createProviderSseDecoder,
  createProviderStreamParser,
  type ProviderCompletion,
} from "./provider-stream";
import { buildMemberProviderRequestBody } from "./provider-turn";

export class ProviderChainError extends Error {
  constructor(
    public readonly code: string,
    public readonly cancelled = false,
  ) {
    super(code);
  }
}
type FailureReason =
  | "NETWORK"
  | "FIRST_TOKEN_TIMEOUT"
  | "HTTP_5XX"
  | "PROVIDER_RATE_LIMIT"
  | "AUTH"
  | "CANCELLED"
  | "POLICY"
  | "AUDIT";
export function mayFallbackBeforeAnswer(
  reason: FailureReason,
  visibleText: boolean,
  cancelled: boolean,
) {
  return (
    !visibleText &&
    !cancelled &&
    [
      "NETWORK",
      "FIRST_TOKEN_TIMEOUT",
      "HTTP_5XX",
      "PROVIDER_RATE_LIMIT",
    ].includes(reason)
  );
}

/** One original member admission, one durable lease for each distinct attempt,
 * exactly one HTTP dispatch per lease. Keys never choose models or approve paid
 * calls. No fallback after visible output, cancellation, authentication or audit
 * failure; unknown charged costs remain reserved in the DB. */
export async function runMemberProviderChain(input: {
  nvidiaApiKey: string;
  openRouterFreeApiKey?: string;
  openRouterPaidApiKey?: string;
  paidCallAuthorized: boolean;
  instructions: string;
  question: string;
  history: readonly ProviderHistoryMessage[];
  maxOutputTokens: number;
  firstTokenTimeoutMs: number;
  signal: AbortSignal;
  port: ProviderAttemptPort;
  onDelta: (text: string) => void;
  fetcher?: typeof fetch;
  registryReader?: typeof readProviderRegistry;
}): Promise<ProviderCompletion> {
  const models = [
    NVIDIA_MODELS[0],
    NVIDIA_MODELS[1],
    OPENROUTER_FREE_MODEL,
    OPENROUTER_PAID_MODEL,
  ];
  const fetcher = input.fetcher ?? fetch;
  let visible = false;
  const checkCancelled = () => {
    if (input.signal.aborted)
      throw new ProviderChainError("CLIENT_CANCELLED", true);
  };
  checkCancelled();
  if (!input.nvidiaApiKey.trim())
    throw new ProviderChainError("AI_PROVIDER_NOT_CONFIGURED");
  let lastCode = "AI_PROVIDER_UNAVAILABLE";
  for (let index = 0; index < models.length; index++) {
    checkCancelled();
    const model = models[index]!;
    const provider = index < 2 ? ("nvidia" as const) : ("openrouter" as const);
    const tier =
      index < 2
        ? ("trial" as const)
        : index === 2
          ? ("free" as const)
          : ("paid" as const);
    const key =
      index < 2
        ? input.nvidiaApiKey
        : index === 2
          ? input.openRouterFreeApiKey
          : input.openRouterPaidApiKey;
    if (!key?.trim()) break;
    if (
      tier === "paid" &&
      (!input.paidCallAuthorized || key === input.openRouterFreeApiKey)
    )
      throw new ProviderChainError("AI_PAID_CALL_NOT_AUTHORIZED");
    let proof: OpenRouterModelProof | undefined;
    let maxCostMicroUsd = 0n;
    if (provider === "openrouter") {
      try {
        proof = await (input.registryReader ?? readProviderRegistry)(
          model,
          input.signal,
        );
      } catch {
        checkCancelled();
        throw new ProviderChainError("OPENROUTER_MODEL_UNVERIFIED");
      }
      checkCancelled();
      if (tier === "free") {
        try {
          await input.port.admitFree();
        } catch (error) {
          throw new ProviderChainError(
            error instanceof Error && error.message === "AI_FREE_POOL_LIMIT"
              ? "AI_FREE_POOL_LIMIT"
              : "AI_PROVIDER_ADMISSION_FAILED",
          );
        }
      }
    }
    const body = buildMemberProviderRequestBody({
      provider,
      model,
      instructions: input.instructions,
      question: input.question,
      history: input.history,
      maxOutputTokens: input.maxOutputTokens,
      ...(proof ? { modelProof: proof, nowMs: Date.now() } : {}),
    });
    if (tier === "paid" && proof && "messages" in body)
      maxCostMicroUsd = estimatePaidReservationMicroUsd(
        proof,
        body.messages,
        input.maxOutputTokens,
        Date.now(),
      );
    let lease;
    try {
      lease = await input.port.reserve({
        attemptKey: `member-ai-v1:${index + 1}:${model}`,
        provider,
        model,
        paid: tier === "paid",
        maxCostMicroUsd,
      });
    } catch {
      throw new ProviderChainError("AI_PROVIDER_ADMISSION_FAILED");
    }
    if (lease.replay || lease.status !== "RESERVED")
      throw new ProviderChainError("AI_PROVIDER_ATTEMPT_ALREADY_EXISTS");
    if (input.signal.aborted) {
      await input.port.settle({
        attemptId: lease.id,
        status: "NOT_SENT",
        costMicroUsd: 0n,
      });
      checkCancelled();
    }
    let dispatched;
    try {
      dispatched = await input.port.settle({
        attemptId: lease.id,
        status: "DISPATCHED",
      });
    } catch {
      throw new ProviderChainError("AI_PROVIDER_AUDIT_UNVERIFIED");
    }
    if (dispatched.replay || dispatched.status !== "DISPATCHED")
      throw new ProviderChainError("AI_PROVIDER_ATTEMPT_ALREADY_EXISTS");
    const abort = new AbortController();
    const signal = AbortSignal.any([input.signal, abort.signal]);
    let reason: FailureReason = "NETWORK",
      startedFetch = false,
      firstTokenTimedOut = false;
    const firstTokenTimer = setTimeout(() => {
      firstTokenTimedOut = true;
      abort.abort();
    }, input.firstTokenTimeoutMs);
    const totalTimer = setTimeout(() => abort.abort(), 90_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let completed: ProviderCompletion | undefined;
    try {
      checkCancelled();
      startedFetch = true;
      const response = await fetcher(
        provider === "nvidia" ? NVIDIA_CHAT_URL : OPENROUTER_CHAT_URL,
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        reason =
          response.status === 401 || response.status === 403
            ? "AUTH"
            : response.status === 429
              ? "PROVIDER_RATE_LIMIT"
              : response.status >= 500
                ? "HTTP_5XX"
                : "POLICY";
        lastCode =
          reason === "AUTH"
            ? "PROVIDER_AUTH_REJECTED"
            : response.status === 429
              ? "PROVIDER_RATE_LIMITED"
              : "PROVIDER_REQUEST_FAILED";
        await response.body?.cancel().catch(() => undefined);
        throw new ProviderChainError(lastCode);
      }
      if (
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        reason = "POLICY";
        throw new ProviderChainError("PROVIDER_STREAM_REQUIRED");
      }
      reader = response.body.getReader();
      const decode = createProviderSseDecoder();
      const parse = createProviderStreamParser({
        model,
        provider,
        tier,
        ...(proof
          ? {
              providerName: proof.providerName,
              reservedCostMicroUsd: maxCostMicroUsd,
            }
          : {}),
      });
      let sawText = false;
      for (;;) {
        const chunk = await reader.read();
        checkCancelled();
        for (const data of decode(chunk.value, chunk.done)) {
          const event = parse(data);
          if (event.kind === "failed") {
            reason = "POLICY";
            throw new ProviderChainError(event.code);
          }
          if (event.kind === "delta") {
            sawText = true;
            clearTimeout(firstTokenTimer);
            // The caller's policy guard runs before any text is emitted.
            try {
              input.onDelta(event.text);
            } catch {
              reason = "POLICY";
              throw new ProviderChainError("AI_OUTPUT_POLICY_REJECTED");
            }
            visible = true;
          }
          if (event.kind === "completed") completed = event;
        }
        if (completed || chunk.done) break;
      }
      if (!completed || !sawText) {
        reason = "POLICY";
        throw new ProviderChainError("PROVIDER_COMPLETION_UNVERIFIED");
      }
      const settled = await input.port.settle({
        attemptId: lease.id,
        status: "SUCCEEDED",
        providerRequestId: completed.providerRequestId,
        inputTokens: completed.inputTokens,
        outputTokens: completed.outputTokens,
        cachedInputTokens: completed.cachedInputTokens,
        costMicroUsd: completed.costMicroUsd,
        costNanoUsd: completed.costNanoUsd,
        upstreamProvider: completed.upstreamProvider,
      });
      if (settled.status !== "SUCCEEDED" || settled.replay) {
        reason = "AUDIT";
        throw new ProviderChainError("AI_PROVIDER_AUDIT_UNVERIFIED");
      }
      return completed;
    } catch (error) {
      const cancelled = input.signal.aborted;
      if (cancelled) {
        reason = "CANCELLED";
        lastCode = "CLIENT_CANCELLED";
      } else if (firstTokenTimedOut) {
        reason = "FIRST_TOKEN_TIMEOUT";
        lastCode = "PROVIDER_FIRST_TOKEN_TIMEOUT";
      } else if (error instanceof ProviderChainError) lastCode = error.code;
      else lastCode = "PROVIDER_UNREACHABLE";
      try {
        await input.port.settle({
          attemptId: lease.id,
          status: !startedFetch
            ? "NOT_SENT"
            : cancelled
              ? "CANCELLED"
              : "UNKNOWN",
          costMicroUsd: startedFetch ? null : 0n,
        });
      } catch {
        throw new ProviderChainError("AI_PROVIDER_AUDIT_UNVERIFIED");
      }
      if (!mayFallbackBeforeAnswer(reason, visible, cancelled))
        throw new ProviderChainError(lastCode, cancelled);
    } finally {
      clearTimeout(firstTokenTimer);
      clearTimeout(totalTimer);
      abort.abort();
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
  }
  throw new ProviderChainError(lastCode);
}
