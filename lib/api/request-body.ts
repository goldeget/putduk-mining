export type BoundedJsonBody =
  | { ok: true; value: unknown }
  | { ok: false; code: "INVALID_JSON" | "PAYLOAD_TOO_LARGE" };

/** Bound bytes while reading, including chunked bodies and misleading lengths. */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonBody> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { ok: false, code: "PAYLOAD_TOO_LARGE" };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, code: "INVALID_JSON" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength === 0) continue;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, code: "INVALID_JSON" };
  } finally {
    reader.releaseLock();
  }
}
