import {
  WorkroomAppMemberCommandSchema,
  WorkroomAppAdminCommandSchema,
} from "./contract";

type Identity = { userId: string };
type Access =
  | { ok: true; identity: Identity }
  | { ok: false; status: number; code: string };
export type AppDependencies = {
  origin: string;
  authorize: (request: Request, write: boolean) => Promise<Access>;
  invoke: (
    identity: Identity,
    operation: string,
    key: string | null,
    input: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
type Audience = "member" | "admin";
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
function fail(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}
function rpcFailure(message: string) {
  if (/CONFLICT|MISMATCH/.test(message))
    return fail(
      "REQUEST_CONFLICT",
      "같은 요청의 내용이 달라요. 문의 내역을 확인해 주세요.",
      409,
    );
  if (/AUTH|ROLE|SESSION|MFA|FORBIDDEN|DENIED/.test(message))
    return fail(
      "ACCESS_DENIED",
      "로그인과 이용 권한을 다시 확인해 주세요.",
      403,
    );
  if (/NOT_FOUND/.test(message))
    return fail("NOT_FOUND", "해당 내용을 찾을 수 없어요.", 404);
  if (/INVALID|BODY|LIMIT/.test(message))
    return fail("INVALID_INPUT", "입력 내용을 확인해 주세요.", 400);
  return fail(
    "RESULT_UNCONFIRMED",
    "결과를 확인하지 못했어요. 같은 요청으로 다시 시도해 주세요.",
    503,
  );
}
async function invoke(
  request: Request,
  deps: AppDependencies,
  audience: Audience,
  value: unknown,
  write: boolean,
) {
  const access = await deps.authorize(request, write);
  if (!access.ok)
    return fail(
      access.code,
      "로그인과 이용 권한을 확인해 주세요.",
      access.status,
    );
  const parsed = (
    audience === "member"
      ? WorkroomAppMemberCommandSchema
      : WorkroomAppAdminCommandSchema
  ).safeParse(value);
  if (!parsed.success)
    return fail("INVALID_INPUT", "입력 내용을 확인해 주세요.", 400);
  const read = ["SUPPORT_READ", "NOTIFICATIONS_READ"].includes(
    parsed.data.operation,
  );
  if (read === write)
    return fail("INVALID_OPERATION", "요청 방식을 확인해 주세요.", 400);
  // Push binding is owned by the authenticated device-registration path.
  if (
    ![
      "SUPPORT_READ",
      "SUPPORT_SEND",
      "SUPPORT_REPLY",
      "SUPPORT_ASSIGN",
      "SUPPORT_RESOLVE",
      "SUPPORT_SEEN",
      "NOTIFICATIONS_READ",
      "NOTIFICATION_READ",
    ].includes(parsed.data.operation)
  )
    return fail("INVALID_OPERATION", "요청 방식을 확인해 주세요.", 400);
  const result = await deps.invoke(
    access.identity,
    parsed.data.operation,
    parsed.data.requestKey ?? null,
    parsed.data.input,
  );
  if (result.error) return rpcFailure(result.error.message);
  if (!result.data || typeof result.data !== "object")
    return rpcFailure("UNAVAILABLE");
  return json({ data: result.data });
}
export async function handleAppRead(
  request: Request,
  deps: AppDependencies,
  audience: Audience,
) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const { operation, ...input } = query;
    if (input.limit !== undefined)
      (input as Record<string, unknown>).limit = Number(input.limit);
    return await invoke(request, deps, audience, { operation, input }, false);
  } catch {
    return rpcFailure("UNAVAILABLE");
  }
}
async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  let size = 0;
  let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("TOO_LARGE");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } finally {
    reader.releaseLock();
  }
}
export async function handleAppWrite(
  request: Request,
  deps: AppDependencies,
  audience: Audience,
) {
  if (request.headers.get("origin") !== deps.origin)
    return fail("ORIGIN_DENIED", "같은 사이트에서 요청해 주세요.", 403);
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return fail("INVALID_CONTENT_TYPE", "요청 형식을 확인해 주세요.", 415);
  try {
    let body: unknown;
    try {
      body = await boundedJson(request);
    } catch (error) {
      return fail(
        "INVALID_BODY",
        "요청 내용을 확인해 주세요.",
        error instanceof Error && error.message === "TOO_LARGE" ? 413 : 400,
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return fail("INVALID_BODY", "요청 내용을 확인해 주세요.", 400);
    // A body-supplied key cannot replace the retry identity sent in the header.
    if (Object.hasOwn(body, "requestKey"))
      return fail("INVALID_BODY", "요청 내용을 확인해 주세요.", 400);
    return await invoke(
      request,
      deps,
      audience,
      { ...body, requestKey: request.headers.get("Idempotency-Key") },
      true,
    );
  } catch {
    return rpcFailure("UNAVAILABLE");
  }
}
