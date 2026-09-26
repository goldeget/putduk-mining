import { NextResponse } from "next/server";

import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다." } },
      { status: 401 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("bootstrap_user", {
    p_user_id: identity.userId,
  });

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: "BOOTSTRAP_UNAVAILABLE",
          message: "계정 준비를 완료하지 못했습니다.",
        },
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ data: { ready: true } });
}
