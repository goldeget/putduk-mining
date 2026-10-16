/** A deadline stops UI waiting; it cannot attest that the server rolled back. */
export async function requestKyc(
  path: string,
  init: RequestInit = {},
  deadlineMs = 15_000,
) {
  const controller = new AbortController();
  const upstream = init.signal;
  const abort = () => controller.abort();
  if (upstream?.aborted) abort();
  else upstream?.addEventListener("abort", abort, { once: true });
  let cancel!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    cancel = () =>
      reject(new DOMException("KYC result unconfirmed", "AbortError"));
  });
  controller.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(abort, deadlineMs);
  try {
    if (controller.signal.aborted)
      throw new DOMException("KYC result unconfirmed", "AbortError");
    return await Promise.race([
      fetch(path, { ...init, signal: controller.signal }).then(
        async (response) => ({
          response,
          payload: (await response.json()) as unknown,
        }),
      ),
      stopped,
    ]);
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancel);
  }
}
