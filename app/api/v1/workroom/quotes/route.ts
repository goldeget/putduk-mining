import { getVerifiedMemberSession } from "@/lib/auth/verified-member-session";
import { readWorkroomQuotes } from "@/lib/workroom/quotes";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    if (!(await getVerifiedMemberSession()))
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다." } },
        { status: 401, headers },
      );
    return Response.json({ data: await readWorkroomQuotes() }, { headers });
  } catch {
    return Response.json(
      {
        error: {
          code: "REFERENCE_UNAVAILABLE",
          message: "참고 시세를 불러오지 못했습니다.",
        },
      },
      { status: 503, headers },
    );
  }
}
