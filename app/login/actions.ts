"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { safeProtectedReturnPath } from "@/lib/auth/return-path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(4).max(254),
  next: z.string(),
  password: z.string().min(10).max(128),
});

export type AuthActionState = {
  message: string;
  status: "idle" | "error";
};

async function resolveLoginEmail(identifier: string) {
  const normalized = identifier.toLowerCase();
  const email = z.email().safeParse(normalized);
  if (email.success) {
    return { email: email.data, serviceAvailable: true } as const;
  }

  if (!/^[a-z][a-z0-9_]{3,19}$/.test(normalized)) {
    return { email: null, serviceAvailable: true } as const;
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("resolve_login_email", {
      p_login_id: normalized,
    });

    if (error) {
      return { email: null, serviceAvailable: false } as const;
    }

    return {
      email: typeof data === "string" && data ? data : null,
      serviceAvailable: true,
    } as const;
  } catch {
    return { email: null, serviceAvailable: false } as const;
  }
}

async function bootstrapUser(userId: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("bootstrap_user", { p_user_id: userId });
  if (error) {
    throw new Error("USER_BOOTSTRAP_FAILED");
  }
}

export async function authenticateAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    identifier: formData.get("identifier"),
    next: formData.get("next") ?? "/home",
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      message: "아이디 또는 복구 이메일과 비밀번호를 확인해 주세요.",
      status: "error",
    };
  }

  const nextPath = safeProtectedReturnPath(parsed.data.next);
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return {
      message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }

  const resolution = await resolveLoginEmail(parsed.data.identifier);
  if (!resolution.serviceAvailable) {
    return {
      message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    authResult = await supabase.auth.signInWithPassword({
      email:
        resolution.email ?? `unavailable-${crypto.randomUUID()}@putduk.invalid`,
      password: parsed.data.password,
    });
  } catch {
    return {
      message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }

  const { data, error } = authResult;

  if (error || !data.user || !resolution.email) {
    // Auth 타임아웃·게이트웨이 오류를 잘못된 비밀번호로 오인하지 않는다.
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status?: number }).status)
        : NaN;
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code ?? "")
        : "";
    if (
      status === 504 ||
      status === 408 ||
      code === "request_timeout" ||
      /timeout|timed out|abort/i.test(error?.message ?? "")
    ) {
      return {
        message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        status: "error",
      };
    }
    return { message: "로그인 정보를 확인해 주세요.", status: "error" };
  }

  try {
    await bootstrapUser(data.user.id);
  } catch {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The generic error below avoids exposing bootstrap internals.
    }
    return {
      message: "계정 준비를 마치지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: "error",
    };
  }

  redirect(nextPath as Route);
}
