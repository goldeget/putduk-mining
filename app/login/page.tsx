import type { Metadata } from "next";

import { AuthForm } from "@/app/login/auth-form";
import { AuthExperience } from "@/components/auth/auth-experience";
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
    <AuthExperience
      route="/login"
      titleId="auth-title"
      eyebrow="안전한 로그인"
      title="나의 채굴로 돌아가기"
      description="로그인하면 채굴 상태와 지갑을 이어서 확인할 수 있어요."
      panelTitle="다시 만나 반가워요."
      panelDescription="아이디 또는 복구 이메일로 로그인해 주세요."
      footer={
        <p>
          계정 정보를 잊으셨다면 아이디 찾기나 비밀번호 재설정을 이용해 주세요.
        </p>
      }
    >
      {statusMessage ? (
        <p
          className="auth-form__message auth-form__message--success"
          role="status"
        >
          {statusMessage}
        </p>
      ) : null}
      <AuthForm nextPath={nextPath} />
    </AuthExperience>
  );
}
