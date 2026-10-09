import type { Metadata } from "next";

import { AuthForm } from "@/app/login/auth-form";
import { LoginExperience } from "@/components/auth/login-experience";
import { safeProtectedReturnPath } from "@/lib/auth/return-path";

export const metadata: Metadata = {
  title: "로그인",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ logout?: string; next?: string; password?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeProtectedReturnPath(params.next);
  const statusMessage =
    params.password === "updated"
      ? "비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요."
      : params.logout === "global"
        ? "모든 기기에서 안전하게 로그아웃했습니다."
        : params.logout === "local"
          ? "이 기기에서 로그아웃했습니다."
          : null;

  return (
    <LoginExperience>
      {statusMessage ? (
        <p
          className="auth-form__message auth-form__message--success"
          role="status"
        >
          {statusMessage}
        </p>
      ) : null}
      <AuthForm nextPath={nextPath} />
    </LoginExperience>
  );
}
