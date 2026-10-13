import { FeedbackMessage } from "@/components/ui/feedback-message";
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
  searchParams: Promise<{
    logout?: string;
    next?: string;
    password?: string;
    push?: string;
  }>;
}) {
  const params = await searchParams;
  const nextPath = safeProtectedReturnPath(params.next);
  const authStatusMessage =
    params.password === "updated"
      ? "비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요."
      : params.logout === "global"
        ? "모든 기기에서 안전하게 로그아웃했습니다."
        : params.logout === "local"
          ? "이 기기에서 로그아웃했습니다."
          : null;
  const statusMessage =
    authStatusMessage &&
    params.push === "unconfirmed" &&
    ["local", "global"].includes(params.logout ?? "")
      ? `${authStatusMessage} 기기 알림 해제는 확인하지 못했어요. 이 기기의 브라우저 알림 설정도 확인해 주세요.`
      : authStatusMessage;

  return (
    <LoginExperience>
      {statusMessage ? (
        <FeedbackMessage
          className="auth-form__message auth-form__message--success"
          role="status"
        >
          {statusMessage}
        </FeedbackMessage>
      ) : null}
      <AuthForm nextPath={nextPath} />
    </LoginExperience>
  );
}
