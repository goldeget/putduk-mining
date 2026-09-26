export const SUPABASE_SERVER_FETCH_TIMEOUT_MS = 5_000;

type ServerFetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createSupabaseServerFetch({
  fetchImpl = globalThis.fetch,
  timeoutMs = SUPABASE_SERVER_FETCH_TIMEOUT_MS,
}: ServerFetchOptions = {}): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Supabase server fetch timeout must be positive.");
  }

  return async (input, init) => {
    const controller = new AbortController();
    const requestSignal = init?.signal;
    const abortFromRequest = () => controller.abort(requestSignal?.reason);

    if (requestSignal?.aborted) {
      abortFromRequest();
    } else {
      requestSignal?.addEventListener("abort", abortFromRequest, {
        once: true,
      });
    }

    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abortFromRequest);
    }
  };
}

export const supabaseServerFetch = createSupabaseServerFetch();
