import { cookies } from "next/headers";
import { z } from "zod";

import {
  getVerifiedRecoveryAuthorization,
  RECOVERY_PROOF_COOKIE,
} from "@/app/auth/update-password/recovery-proof";

export const runtime = "nodejs";

const passwordSchema = z
  .object({
    password: z.string().min(10).max(128),
    passwordConfirmation: z.string().min(10).max(128),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
  });

type UpdatePasswordResponse = {
  status: "ok" | "error";
  message: string;
  redirectUrl?: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        status: "error",
        message: "요청 형식이 올바르지 않습니다.",
      } satisfies UpdatePasswordResponse,
      { status: 400 },
    );
  }

  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        status: "error",
        message: "10자 이상의 같은 비밀번호를 두 번 입력해 주세요.",
      } satisfies UpdatePasswordResponse,
      { status: 400 },
    );
  }

  const authorization = await getVerifiedRecoveryAuthorization();
  if (!authorization) {
    return Response.json(
      {
        status: "error",
        message:
          "확인 링크가 만료되었거나 이 기기에서 확인되지 않았어요. 재설정 안내를 다시 요청해 주세요.",
      } satisfies UpdatePasswordResponse,
      { status: 401 },
    );
  }

  try {
    const { error } = await authorization.supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) {
      return Response.json(
        {
          status: "error",
          message:
            "비밀번호를 변경하지 못했어요. 확인 링크를 다시 요청해 주세요.",
        } satisfies UpdatePasswordResponse,
        { status: 502 },
      );
    }
  } catch {
    return Response.json(
      {
        status: "error",
        message: "연결을 확인한 뒤 다시 시도해 주세요.",
      } satisfies UpdatePasswordResponse,
      { status: 502 },
    );
  }

  // The recovery proof is consumed once the password write succeeds; clear it
  // before signing out so a failed signOut cannot leave a reusable proof behind.
  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_PROOF_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/auth/update-password",
    sameSite: "lax",
  });

  try {
    const { error } = await authorization.supabase.auth.signOut({
      scope: "global",
    });
    if (error) throw error;
  } catch {
    try {
      await authorization.supabase.auth.signOut({ scope: "local" });
    } catch {
      // The recovery proof is already consumed; do not retry the password write.
    }
    return Response.json(
      {
        status: "error",
        message:
          "비밀번호는 변경됐지만 모든 기기의 로그아웃을 완료하지 못했어요. 계정 지원에 문의해 주세요.",
      } satisfies UpdatePasswordResponse,
      { status: 502 },
    );
  }

  return Response.json(
    {
      status: "ok",
      message: "",
      redirectUrl: "/login?password=updated",
    } satisfies UpdatePasswordResponse,
    { status: 200 },
  );
}
