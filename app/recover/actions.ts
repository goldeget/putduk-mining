"use server";

import { z } from "zod";

import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RecoveryActionState = {
  message: string;
  status: "idle" | "confirmation";
};

const recoveryEmailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email(),
);

export async function requestPasswordRecovery(
  _previous: RecoveryActionState,
  formData: FormData,
): Promise<RecoveryActionState> {
  const parsed = recoveryEmailSchema.safeParse(formData.get("email"));
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

  return {
    message:
      "입력한 정보와 일치하는 계정이 있으면 비밀번호 재설정 안내를 보냈습니다.",
    status: "confirmation",
  };
}
