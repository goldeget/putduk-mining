import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { parseMiningServerDisplay } from "@/lib/product/mining-server-display";
import { toMiningLiveSnapshot } from "@/lib/product/mining-live-snapshot";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";

export const dynamic = "force-dynamic";

/** Read-only projection. No body/query may select a financial subject. */
export async function GET(request: Request) {
  const identity = await getVerifiedIdentity();
  let response;
  if (!identity)
    response = apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  else if (
    new URL(request.url).search ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    response = apiError({
      code: "MINING_DISPLAY_CONTEXT_REJECTED",
      message: "현재 화면에서 다시 확인해 주세요.",
      status: 400,
    });
  else if (request.headers.get("X-Putduk-Mining-Owner") !== identity.userId)
    response = apiError({
      code: "MINING_SESSION_CHANGED",
      message: "로그인 상태가 바뀌었어요. 화면을 다시 열어 주세요.",
      status: 409,
    });
  else {
    try {
      const read = await readOwnMiningServerDisplay(identity);
      const display = read.error ? null : parseMiningServerDisplay(read.data);
      if (!display)
        response = apiError({
          code: "MINING_DISPLAY_UNAVAILABLE",
          message: "채굴 기록을 확인하지 못했어요. 다시 확인해 주세요.",
          status: 503,
        });
      else {
        const snapshot = toMiningLiveSnapshot(display);
        response =
          display.available && !snapshot
            ? apiError({
                code: "MINING_DISPLAY_UNCONFIRMED",
                message: "현재 채굴 기록을 다시 확인해 주세요.",
                status: 503,
              })
            : apiSuccess({ ownerId: identity.userId, snapshot });
      }
    } catch {
      response = apiError({
        code: "MINING_DISPLAY_UNAVAILABLE",
        message: "채굴 기록을 확인하지 못했어요. 다시 확인해 주세요.",
        status: 503,
      });
    }
  }
  response.headers.set("Vary", "Cookie, Authorization");
  return response;
}
