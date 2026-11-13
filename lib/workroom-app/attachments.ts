import { z } from "zod";
import {
  WorkroomAppAttachmentPreparedSchema,
  WorkroomAppAttachmentCommittedSchema,
  WorkroomAppAttachmentReadSchema,
} from "./contract";
import type { AppDependencies } from "./handler";

const maxBytes = 5242880;
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,190}$/);
const pathSchema = z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i);
export type AttachmentDependencies = AppDependencies & {
  storage: {
    upload: (
      path: string,
      bytes: Uint8Array,
      mediaType: string,
    ) => Promise<boolean>;
    download: (path: string) => Promise<Uint8Array | null>;
    sign: (path: string) => Promise<string | null>;
  };
};
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function error(
  status: number,
  message = "사진을 처리하지 못했어요. 같은 사진으로 다시 시도해 주세요.",
) {
  return json({ error: { code: "ATTACHMENT_UNAVAILABLE", message } }, status);
}
export function detectSupportImage(bytes: Uint8Array, mediaType: string) {
  if (!bytes.length || bytes.length > maxBytes) return false;
  if (mediaType === "image/jpeg")
    return (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (mediaType === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    );
  if (mediaType === "image/webp")
    return (
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  return false;
}
async function readBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", new Uint8Array(left)),
    crypto.subtle.digest("SHA-256", new Uint8Array(right)),
  ]);
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < x.length; index++)
    difference |= x[index]! ^ y[index]!;
  return difference === 0;
}
export async function handleAttachmentUpload(
  request: Request,
  deps: AttachmentDependencies,
) {
  if (request.headers.get("origin") !== deps.origin)
    return error(403, "같은 사이트에서 요청해 주세요.");
  try {
    const access = await deps.authorize(request, true);
    if (!access.ok)
      return error(access.status, "로그인과 이용 권한을 확인해 주세요.");
    const key = keySchema.safeParse(request.headers.get("Idempotency-Key"));
    const mediaType =
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    if (!key.success) return error(400, "요청 식별자를 확인해 주세요.");
    if (Number(request.headers.get("content-length")) > maxBytes)
      return error(413, "사진 한 장은 5MB까지 보낼 수 있어요.");
    let bytes: Uint8Array;
    try {
      bytes = await readBytes(request);
    } catch (cause) {
      return error(
        cause instanceof Error && cause.message === "TOO_LARGE" ? 413 : 400,
      );
    }
    if (!detectSupportImage(bytes, mediaType))
      return error(400, "5MB 이하의 JPG, PNG, WebP 사진을 선택해 주세요.");
    const prepared = await deps.invoke(
      access.identity,
      "ATTACHMENT_PREPARE",
      `${key.data}_prepare`,
      { mediaType, sizeBytes: bytes.length },
    );
    if (prepared.error)
      return error(
        /FORBIDDEN|AUTH|MFA|SESSION/.test(prepared.error.message) ? 403 : 503,
      );
    const attachment = WorkroomAppAttachmentPreparedSchema.parse(prepared.data);
    if (!pathSchema.safeParse(attachment.path).success) return error(503);
    const uploaded = await deps.storage.upload(
      attachment.path,
      bytes,
      mediaType,
    );
    if (!uploaded) {
      const existing = await deps.storage.download(attachment.path);
      if (!existing || !(await sameBytes(bytes, existing)))
        return error(
          409,
          "사진 전송 상태가 달라요. 사진을 다시 선택해 주세요.",
        );
    }
    // Revalidate the live caller after external storage I/O, before linking anything.
    const current = await deps.authorize(request, true);
    if (!current.ok || current.identity.userId !== access.identity.userId)
      return error(403, "로그인 상태가 변경됐어요. 다시 확인해 주세요.");
    const committed = await deps.invoke(
      current.identity,
      "ATTACHMENT_COMMIT",
      `${key.data}_commit`,
      { id: attachment.id },
    );
    if (committed.error)
      return error(
        /FORBIDDEN|AUTH|MFA|SESSION/.test(committed.error.message) ? 403 : 503,
      );
    return json({
      data: WorkroomAppAttachmentCommittedSchema.parse(committed.data),
    });
  } catch {
    return error(503);
  }
}
export async function handleAttachmentRead(
  request: Request,
  deps: AttachmentDependencies,
) {
  try {
    const access = await deps.authorize(request, false);
    if (!access.ok)
      return error(access.status, "로그인과 이용 권한을 확인해 주세요.");
    const query = z
      .object({ id: z.uuid() })
      .strict()
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return error(400);
    const result = await deps.invoke(
      access.identity,
      "ATTACHMENT_READ",
      null,
      query.data,
    );
    if (result.error)
      return error(
        /FORBIDDEN|AUTH|MFA|SESSION/.test(result.error.message) ? 403 : 404,
        "이 사진을 확인할 수 없어요.",
      );
    const item = WorkroomAppAttachmentReadSchema.parse(result.data);
    if (!pathSchema.safeParse(item.path).success) return error(503);
    const url = await deps.storage.sign(item.path);
    if (!url) return error(503);
    return json({ data: { url } });
  } catch {
    return error(503);
  }
}
