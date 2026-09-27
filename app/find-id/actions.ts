"use server";

import { z } from "zod";

import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FindIdActionState = {
  message: string;
  status: "idle" | "confirmation";
};

const recoveryEmailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email(),
);

export async function requestLoginIdLink(
  _previous: FindIdActionState,
  formData: FormData,
): Promise<FindIdActionState> {
  const parsed = recoveryEmailSchema.safeParse(formData.get("email"));
  if (parsed.success) {
    try {
      const supabase = await createSupabaseServerClient();
      const env = getPublicEnv();
      await supabase.auth.signInWithOtp({
        email: parsed.data,
        options: {
          emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent("/menu/account")}`,
          shouldCreateUser: false,
        },
      });
    } catch {
      // Keep the response identical for existing and unknown accounts.
    }
  }

  return {
    message:
      "입력한 정보와 일치하는 계정이 있으면 아이디 확인 링크를 보냈습니다.",
    status: "confirmation",
  };
}
