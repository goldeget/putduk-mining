import { handleWorkroomRead } from "@/lib/workroom/handler";
import { workroomDependencies } from "@/lib/workroom/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return await handleWorkroomRead(workroomDependencies());
  } catch {
    return Response.json(
      {
        error: {
          code: "WORKROOM_UNAVAILABLE",
          message: "워크룸 연결을 준비하고 있습니다.",
        },
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
