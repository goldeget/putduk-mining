/** Stop waiting locally; abort does not imply rollback of an accepted server request. */
export function waitForAdminResult<T>(
  result: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () =>
      reject(new DOMException("Confirmation interrupted", "AbortError"));
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(result)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
