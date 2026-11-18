import { z } from "zod";

import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const recoveryEmailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email(),
);

type RecoveryResponse = {
  status: "confirmation";
  message: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        status: "confirmation",
        message:
          "입력한 정보와 일치하는 계정이 있으면 비밀번호 재설정 안내를 보냈습니다.",
      } satisfies RecoveryResponse,
      { status: 200 },
    );
  }

  const parsed = recoveryEmailSchema.safeParse(
    (body as Record<string, unknown> | null)?.email ?? "",
  );

  if (parsed.success) {
    try {
      const supabase = await createSupabaseServerClient();
      const env = getPublicEnv();
      await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent("/auth/update-password")}`,
      });
    } catch {
      // The same response prevents account enumeration and allows a safe retry.
    }
  }

  return Response.json(
    {
      status: "confirmation",
      message:
        "입력한 정보와 일치하는 계정이 있으면 비밀번호 재설정 안내를 보냈습니다.",
    } satisfies RecoveryResponse,
    { status: 200 },
  );
}
