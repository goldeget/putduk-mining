import "server-only";

import {
  assertOpenRouterModelProof,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_PAID_MODEL,
  OPENROUTER_MODELS_URL,
  verifyOpenRouterModel,
  type OpenRouterModelProof,
} from "./provider-models";

async function boundedJson(response: Response) {
  if (!response.ok || !response.body)
    throw new Error("OPENROUTER_REGISTRY_UNAVAILABLE");
  const reader = response.body.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8 * 1024 * 1024)
        throw new Error("OPENROUTER_REGISTRY_TOO_LARGE");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Read public catalogs only when this exact fallback is needed. No key, user,
 * question or history is included. Errors and expired metadata are not cached. */
export function createProviderRegistryReader(options?: {
  fetcher?: typeof fetch;
  nowMs?: () => number;
}) {
  const cache = new Map<string, OpenRouterModelProof>();
  const now = options?.nowMs ?? Date.now;
  return async (model: string, signal: AbortSignal) => {
    if (model !== OPENROUTER_FREE_MODEL && model !== OPENROUTER_PAID_MODEL)
      throw new Error("OPENROUTER_MODEL_NOT_APPROVED");
    if (signal.aborted) throw new Error("CLIENT_CANCELLED");
    const started = now();
    const cached = cache.get(model);
    if (cached && started - cached.verifiedAtMs < 300_000) {
      assertOpenRouterModelProof(cached, started);
      return cached;
    }
    const fetcher = options?.fetcher ?? fetch;
    const init: RequestInit = {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      headers: { Accept: "application/json" },
    };
    const [registry, endpoints] = await Promise.all([
      fetcher(OPENROUTER_MODELS_URL, init).then(boundedJson),
      fetcher(`${OPENROUTER_MODELS_URL}/${model}/endpoints`, init).then(
        boundedJson,
      ),
    ]);
    if (signal.aborted) throw new Error("CLIENT_CANCELLED");
    const proof = verifyOpenRouterModel({
      model,
      registry,
      endpointRegistry: endpoints,
      retrievedAtMs: started,
      nowMs: now(),
    });
    cache.set(model, proof);
    return proof;
  };
}
export const readProviderRegistry = createProviderRegistryReader();
