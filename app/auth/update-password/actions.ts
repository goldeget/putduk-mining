"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  getVerifiedRecoveryAuthorization,
  RECOVERY_PROOF_COOKIE,
} from "@/app/auth/update-password/recovery-proof";

const passwordSchema = z
  .object({
    password: z.string().min(10).max(128),
    passwordConfirmation: z.string().min(10).max(128),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
  });

export type UpdatePasswordActionState = {
  message: string;
  status: "idle" | "error";
};

export async function updatePasswordAction(
  _previous: UpdatePasswordActionState,
  formData: FormData,
): Promise<UpdatePasswordActionState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) {
    return {
      message: "10자 이상의 같은 비밀번호를 두 번 입력해 주세요.",
      status: "error",
    };
  }

  const authorization = await getVerifiedRecoveryAuthorization();
  if (!authorization) {
    return {
      message:
        "확인 링크가 만료되었거나 이 기기에서 확인되지 않았어요. 재설정 안내를 다시 요청해 주세요.",
      status: "error",
    };
  }

  try {
    const { error } = await authorization.supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) {
      return {
        message:
          "비밀번호를 변경하지 못했어요. 확인 링크를 다시 요청해 주세요.",
        status: "error",
      };
    }
  } catch {
    return {
      message: "연결을 확인한 뒤 다시 시도해 주세요.",
      status: "error",
    };
  }

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
    return {
      message:
        "비밀번호는 변경됐지만 모든 기기의 로그아웃을 완료하지 못했어요. 계정 지원에 문의해 주세요.",
      status: "error",
    };
  }

  redirect("/login?password=updated");
}
