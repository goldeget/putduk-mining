import type { Metadata } from "next";
import Link from "next/link";
import { AuthExperience } from "@/components/auth/auth-experience";

export const metadata: Metadata = {
  title: "계정 확인 안내",
  robots: { follow: false, index: false },
};

export default function AuthErrorPage() {
  return (
    <AuthExperience
      route="/auth/error"
      titleId="auth-error-title"
      eyebrow="계정 확인 안내"
      title="계정 확인을 완료하지 못했습니다"
      description="링크가 만료됐거나 계정 연결이 지연됐을 수 있어요."
      panelTitle="다시 로그인해 주세요."
      panelDescription="로그인 후 계정 상태를 다시 확인할 수 있어요."
      state="error"
      footer={<Link href="/recover">비밀번호 재설정 안내 받기</Link>}
    >
      <div className="auth-form__actions">
        <Link className="button button--primary" href="/login">
          로그인으로 돌아가기
        </Link>
      </div>
    </AuthExperience>
  );
}
