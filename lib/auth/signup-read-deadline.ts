/** A UI deadline for non-mutating signup availability reads only. */
export const SIGNUP_READ_TIMEOUT_MS = 15_000;

export function waitForSignupRead<T>(
  read: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () =>
      reject(new DOMException("Signup read cancelled", "AbortError"));
    if (signal.aborted) {
      aborted();
    } else signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(read).then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        if (!signal.aborted) resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

export async function withSignupReadDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  controller: AbortController,
): Promise<T> {
  const timeout = window.setTimeout(
    () => controller.abort(),
    SIGNUP_READ_TIMEOUT_MS,
  );
  try {
    return await waitForSignupRead(
      Promise.resolve().then(() => {
        if (controller.signal.aborted)
          throw new DOMException("Signup read cancelled", "AbortError");
        return read(controller.signal);
      }),
      controller.signal,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
