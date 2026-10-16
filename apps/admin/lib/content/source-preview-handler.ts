import "server-only";
import { z } from "zod";

import {
  ContentSourcePreviewError,
  contentSourcePreviewInputSchema,
  previewPinnedContentSource,
} from "../../../../domain/content/source-preview";
import { readBoundedJsonBody } from "../../../../lib/api/request-body";
import { HIGH_IMPACT_ROLES, type AdminRole } from "../auth/policy";

export const CONTENT_SOURCE_PREVIEW_MAX_BODY_BYTES = 512 * 1024;
type SourcePreviewDependencies = {
  authorize: (
    request: Request,
    roles: typeof HIGH_IMPACT_ROLES,
  ) => Promise<
    | {
        ok: true;
        principal: {
          userId: string;
          adminSessionId: string;
          sessionId: string;
          role: AdminRole;
          aal: string;
        };
      }
    | { ok: false; status: number; code: string }
  >;
};
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Origin",
  "X-Content-Type-Options": "nosniff",
};
function failure(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** Only an authorization port exists: no provider, command, grant or DB port. */
export function createContentSourcePreviewHandler(
  deps: SourcePreviewDependencies,
) {
  return async (request: Request) => {
    let access;
    try {
      access = await deps.authorize(request, HIGH_IMPACT_ROLES);
    } catch {
      return failure(
        "SOURCE_AUTH_UNCONFIRMED",
        "운영 화면을 다시 확인해 주세요.",
        503,
      );
    }
    if (!access.ok)
      return failure(
        access.code,
        "원본 안내를 검토할 권한을 확인해 주세요.",
        access.status,
      );
    const principal = access.principal;
    if (
      principal.aal !== "aal2" ||
      !HIGH_IMPACT_ROLES.includes(principal.role) ||
      !z.uuid().safeParse(principal.userId).success ||
      !z.uuid().safeParse(principal.adminSessionId).success ||
      !principal.sessionId
    )
      return failure(
        "SOURCE_AUTH_UNCONFIRMED",
        "운영 인증을 다시 확인해 주세요.",
        403,
      );
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return failure(
        "INVALID_SOURCE_REQUEST",
        "원본 정보를 확인해 주세요.",
        400,
      );
    const body = await readBoundedJsonBody(
      request,
      CONTENT_SOURCE_PREVIEW_MAX_BODY_BYTES,
    );
    if (!body.ok)
      return failure(
        body.code === "PAYLOAD_TOO_LARGE"
          ? "SOURCE_INPUT_TOO_LARGE"
          : "INVALID_SOURCE_REQUEST",
        "원본 파일과 요청 크기를 확인해 주세요.",
        body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      );
    const parsed = contentSourcePreviewInputSchema.safeParse(body.value);
    if (!parsed.success)
      return failure(
        "INVALID_SOURCE_REQUEST",
        "원본 정보를 확인해 주세요.",
        400,
      );
    try {
      return Response.json(
        { data: previewPinnedContentSource(parsed.data) },
        { headers },
      );
    } catch (error) {
      if (error instanceof ContentSourcePreviewError)
        return failure(
          error.code,
          "고정된 원본과 내용이 같은지 확인해 주세요.",
          error.code === "SOURCE_PIN_UNKNOWN" ? 400 : 409,
        );
      return failure(
        "SOURCE_RESULT_UNCONFIRMED",
        "원본 안내를 확인하지 못했습니다. 다시 확인해 주세요.",
        503,
      );
    }
  };
}
