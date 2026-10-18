import "server-only";

import { createHash } from "node:crypto";

export const KYC_EVIDENCE_BUCKET = "kyc-evidence";
export const KYC_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const KYC_MAX_REQUEST_BYTES = KYC_MAX_FILE_BYTES + 64 * 1024;
export const KYC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function inspectKycEvidence(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > KYC_MAX_FILE_BYTES) return null;
  const signature = Buffer.from(bytes.subarray(0, 8));
  const format =
    signature.subarray(0, 5).toString("ascii") === "%PDF-"
      ? { contentType: "application/pdf", extension: "pdf" }
      : signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? { contentType: "image/png", extension: "png" }
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? { contentType: "image/jpeg", extension: "jpg" }
          : null;
  if (!format) return null;
  return {
    ...format,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** One key has one path regardless of the filename or MIME supplied by the caller. */
export function kycEvidencePath(
  userId: string,
  caseId: string,
  requestId: string,
) {
  if (![userId, caseId, requestId].every((id) => KYC_UUID.test(id)))
    throw new Error("INVALID_KYC_IDENTITY");
  return [userId, caseId, requestId].map((id) => id.toLowerCase()).join("/");
}

/** Size and wall-clock limits cover the stream, including absent/dishonest length. */
export async function readKycForm(
  request: Request,
  maximum = KYC_MAX_REQUEST_BYTES,
  deadlineMs = 15_000,
): Promise<FormData | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type)) return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    return null;
  const reader = request.body?.getReader();
  if (!reader || request.signal.aborted) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  let expire!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    expire = () => {
      expired = true;
      reject(new Error("KYC_READ_ABORTED"));
    };
  });
  const timer = setTimeout(expire, deadlineMs);
  request.signal.addEventListener("abort", expire, { once: true });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), stopped]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        expired = true;
        return null;
      }
      chunks.push(part.value);
    }
    return await Promise.race([
      new Response(Buffer.concat(chunks), {
        headers: { "Content-Type": type },
      }).formData(),
      stopped,
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", expire);
    if (expired) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export type KycDocumentPayload = {
  case_id: string;
  document_kind: "IDENTITY_DOCUMENT";
  path: string;
  content_sha256: string;
  mime_type: string;
  size_bytes: number;
};

export function sameKycPayload(
  left: unknown,
  right: KycDocumentPayload | Record<string, never>,
) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const row = left as Record<string, unknown>;
  const fields = Object.keys(right).sort();
  return (
    Object.keys(row).length === fields.length &&
    fields.every((key) => row[key] === (right as Record<string, unknown>)[key])
  );
}
