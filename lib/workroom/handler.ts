import { z } from "zod";
import { readIdempotencyKey } from "@/lib/api/idempotency";

type RpcResult = { data: unknown; error: { message: string } | null };
type Identity = { userId: string };
export type WorkroomDependencies<T extends Identity = Identity> = {
  origin: string;
  authorize: () => Promise<T | null>;
  read: (identity: T) => Promise<RpcResult>;
  command: (
    identity: T,
    operation: string,
    key: string,
    input: Record<string, unknown>,
  ) => Promise<RpcResult>;
};

const empty = z.object({}).strict();
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("OPEN"), input: empty }).strict(),
  z.object({ operation: z.literal("SYNC"), input: empty }).strict(),
  z
    .object({
      operation: z.literal("START"),
      input: z
        .object({
          instrument: z.enum([
            "usd",
            "cny",
            "jpy",
            "nvda",
            "tsla",
            "msft",
            "ndx",
            "skh",
            "samsung",
            "lg",
          ]),
          stake: z.number().int().min(1000).max(1_000_000_000),
          acknowledged: z.literal(true),
          expectedVersion: z.number().int().min(1).max(2147483647),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("FINISH"),
      input: z.object({ id: z.uuid() }).strict(),
    })
    .strict(),
]);
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
function success(data: unknown) {
  return Response.json({ data }, { headers });
}
function failure(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers });
}
function rpcFailure(message: string): Response {
  if (
    /IDEMPOTENCY.*(CONFLICT|MISMATCH)|REQUEST_CONFLICT|ACTIVE_(SESSION|ROUND)|ROUND_ACTIVE|INSUFFICIENT|ALREADY_ACTIVE|NOT_DUE|VERSION_CONFLICT/.test(
      message,
    )
  )
    return failure(
      "WORKROOM_CONFLICT",
      "진행 상태가 변경되었거나 같은 요청 번호가 다른 내용에 사용됐습니다. 내역을 확인해 주세요.",
      409,
    );
  if (
    /INVIT(E|ATION)|COHORT|NOT_ELIGIBLE|NOT_ENROLLED|FORBIDDEN|AUTH|SESSION_REQUIRED/.test(
      message,
    )
  )
    return failure(
      "WORKROOM_ACCESS_DENIED",
      "워크룸 이용 자격을 확인하지 못했습니다. 로그인 상태와 담당자 코드를 확인해 주세요.",
      403,
    );
  if (/NOT_FOUND/.test(message))
    return failure("WORKROOM_NOT_FOUND", "참여 내역을 찾을 수 없습니다.", 404);
  if (/INVALID|ACKNOWLEDG|POINT_RANGE|STAKE/.test(message))
    return failure(
      "WORKROOM_INVALID_INPUT",
      "참여 항목과 연습 포인트를 확인해 주세요.",
      400,
    );
  return failure(
    "WORKROOM_UNAVAILABLE",
    "워크룸을 연결하지 못했습니다. 잠시 후 같은 요청으로 다시 시도해 주세요.",
    503,
  );
}
async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("INVALID_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("TOO_LARGE");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export async function handleWorkroomRead<T extends Identity>(
  dependencies: WorkroomDependencies<T>,
): Promise<Response> {
  try {
    const identity = await dependencies.authorize();
    if (!identity)
      return failure("UNAUTHENTICATED", "로그인이 필요합니다.", 401);
    const result = await dependencies.read(identity);
    if (result.error) return rpcFailure(result.error.message);
    if (!result.data || typeof result.data !== "object")
      return rpcFailure("INVALID_RESULT_UNAVAILABLE");
    return success(result.data);
  } catch {
    return rpcFailure("UNAVAILABLE");
  }
}

export async function handleWorkroomCommand<T extends Identity>(
  request: Request,
  dependencies: WorkroomDependencies<T>,
): Promise<Response> {
  if (request.headers.get("origin") !== dependencies.origin)
    return failure("ORIGIN_DENIED", "동일한 사이트에서 요청해 주세요.", 403);
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return failure("INVALID_CONTENT_TYPE", "요청 형식을 확인해 주세요.", 415);
  const key = readIdempotencyKey(request);
  if (!key)
    return failure(
      "INVALID_IDEMPOTENCY_KEY",
      "요청 식별자를 확인해 주세요.",
      400,
    );
  try {
    const identity = await dependencies.authorize();
    if (!identity)
      return failure("UNAUTHENTICATED", "로그인이 필요합니다.", 401);
    let body: unknown;
    try {
      body = await boundedJson(request);
    } catch (error) {
      return error instanceof Error && error.message === "TOO_LARGE"
        ? failure("REQUEST_TOO_LARGE", "요청이 너무 큽니다.", 413)
        : failure("INVALID_BODY", "요청 내용을 확인해 주세요.", 400);
    }
    const parsed = commandSchema.safeParse(body);
    if (!parsed.success)
      return failure(
        "INVALID_BODY",
        "참여 항목과 연습 포인트를 확인해 주세요.",
        400,
      );
    const result = await dependencies.command(
      identity,
      parsed.data.operation,
      key,
      parsed.data.input,
    );
    if (result.error) return rpcFailure(result.error.message);
    if (!result.data || typeof result.data !== "object")
      return rpcFailure("UNAVAILABLE");
    return success(result.data);
  } catch {
    return rpcFailure("UNAVAILABLE");
  }
}
