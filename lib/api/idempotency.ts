const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;

export function readIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key")?.trim();
  return value && IDEMPOTENCY_KEY_PATTERN.test(value) ? value : null;
}
