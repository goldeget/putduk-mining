import { cookies } from "next/headers";
import { z } from "zod";

import { safeProtectedReturnPath } from "@/lib/auth/return-path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(4).max(254),
  next: z.string(),
  password: z.string().min(10).max(128),
});

type LoginResponse = {
  status: "ok" | "error";
  message: string;
  redirectUrl?: string;
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

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { status: "error", message: "요청 형식이 올바르지 않습니다." } satisfies LoginResponse,
      { status: 400 },
    );
  }

  const parsed = credentialsSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        status: "error",
        message: "아이디 또는 복구 이메일과 비밀번호를 확인해 주세요.",
      } satisfies LoginResponse,
      { status: 400 },
    );
  }

  const nextPath = safeProtectedReturnPath(parsed.data.next);

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json(
      {
        status: "error",
        message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      } satisfies LoginResponse,
      { status: 502 },
    );
  }

  const resolution = await resolveLoginEmail(parsed.data.identifier);
  if (!resolution.serviceAvailable) {
    return Response.json(
      {
        status: "error",
        message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      } satisfies LoginResponse,
      { status: 502 },
    );
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    authResult = await supabase.auth.signInWithPassword({
      email:
        resolution.email ?? `unavailable-${crypto.randomUUID()}@putduk.invalid`,
      password: parsed.data.password,
    });
  } catch {
    return Response.json(
      {
        status: "error",
        message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      } satisfies LoginResponse,
      { status: 502 },
    );
  }

  const { data, error } = authResult;

  if (error || !data.user || !resolution.email) {
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
      return Response.json(
        {
          status: "error",
          message: "계정 서비스를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        } satisfies LoginResponse,
        { status: 502 },
      );
    }
    if (code === "email_not_confirmed" && resolution.email) {
      return Response.json(
        {
          status: "error",
          message:
            "이메일 확인이 아직 끝나지 않았어요. 가입할 때 입력한 이메일에서 확인 안내를 열어 주세요.",
        } satisfies LoginResponse,
        { status: 403 },
      );
    }
    return Response.json(
      { status: "error", message: "로그인 정보를 확인해 주세요." } satisfies LoginResponse,
      { status: 401 },
    );
  }

  try {
    await bootstrapUser(data.user.id);
  } catch {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore
    }
    return Response.json(
      {
        status: "error",
        message: "계정 준비를 마치지 못했어요. 잠시 후 다시 시도해 주세요.",
      } satisfies LoginResponse,
      { status: 502 },
    );
  }

  // Ensure auth cookies are flushed — the server client already set them
  // via setAll, but we touch the store once more to guarantee persistence.
  try {
    const store = await cookies();
    store.getAll(); // no-op, but ensures the cookie jar is committed
  } catch {
    // ignore
  }

  return Response.json(
    {
      status: "ok",
      message: "",
      redirectUrl: nextPath,
    } satisfies LoginResponse,
    { status: 200 },
  );
}
