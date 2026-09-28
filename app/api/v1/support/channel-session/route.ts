import { NextResponse } from "next/server";

import { resolveChannelSession } from "@/lib/support/channel-session-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    return NextResponse.json(await resolveChannelSession(), { headers });
  } catch {
    return NextResponse.json({ mode: "anonymous" }, { headers });
  }
}
