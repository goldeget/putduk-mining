"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";

import { safeProtectedReturnPath } from "@/lib/auth/return-path";
import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email(),
  intent: z.enum(["sign-in", "sign-up"]),
  next: z.string(),
  password: z.string().min(10).max(128),
});

export type AuthActionState = {
  message: string;
  status: "idle" | "error" | "confirmation";
};

async function bootstrapUser(userId: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("bootstrap_user", {
    p_user_id: userId,
  });

  if (error) {
    throw new Error("USER_BOOTSTRAP_FAILED");
  }
}

export async function authenticateAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    intent: formData.get("intent"),
    next: formData.get("next") ?? "/start",
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      message: "이메일과 10자 이상의 비밀번호를 확인해 주세요.",
      status: "error",
    };
  }

  const { email, intent, password } = parsed.data;
  const nextPath = safeProtectedReturnPath(parsed.data.next);
  let env: ReturnType<typeof getPublicEnv>;
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    env = getPublicEnv();
    supabase = await createSupabaseServerClient();
  } catch {
    return {
      message: "계정 서비스 구성이 아직 완료되지 않았습니다.",
      status: "error",
    };
  }

  if (intent === "sign-in") {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return {
        message: "로그인 정보를 확인해 주세요.",
        status: "error",
      };
    }

    try {
      await bootstrapUser(data.user.id);
    } catch {
      return {
        message:
          "계정 초기화를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        status: "error",
      };
    }

    redirect(nextPath as Route);
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(nextPath)}`,
    },
  });

  if (error || !data.user) {
    return {
      message: "가입을 완료하지 못했습니다. 입력 정보를 확인해 주세요.",
      status: "error",
    };
  }

  try {
    await bootstrapUser(data.user.id);
  } catch {
    return {
      message: "계정 초기화를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }

  if (data.session) {
    redirect(nextPath as Route);
  }

  return {
    message: "확인 메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.",
    status: "confirmation",
  };
}
