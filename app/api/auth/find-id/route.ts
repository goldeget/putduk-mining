import { z } from "zod";

import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestBodySchema = z.object({
  email: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.email(),
  ),
});

type FindIdResponse = {
  status: "confirmation";
  message: string;
};

const CONFIRMATION_MESSAGE =
  "입력한 정보와 일치하는 계정이 있으면 아이디 확인 링크를 보냈습니다.";

function confirmationResponse(): Response {
  return Response.json(
    {
      status: "confirmation",
      message: CONFIRMATION_MESSAGE,
    } satisfies FindIdResponse,
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Malformed request body. Keep the response identical to prevent
    // account enumeration and to mirror the original Server Action behavior.
    return confirmationResponse();
  }

  const parsed = requestBodySchema.safeParse(body);
  if (parsed.success) {
    try {
      const supabase = await createSupabaseServerClient();
      const env = getPublicEnv();
      await supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: {
          emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent("/menu/account")}`,
          shouldCreateUser: false,
        },
      });
    } catch {
      // Keep the response identical for existing and unknown accounts.
    }
  }

  return confirmationResponse();
}
