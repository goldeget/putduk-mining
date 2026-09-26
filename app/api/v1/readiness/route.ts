import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("asset_worlds")
      .select("id", { count: "exact", head: true });

    if (error) {
      throw new Error("DATABASE_NOT_READY");
    }

    return NextResponse.json(
      {
        check: "readiness",
        service: "putduk-mining-web",
        status: "ready",
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        check: "readiness",
        service: "putduk-mining-web",
        status: "not_ready",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
