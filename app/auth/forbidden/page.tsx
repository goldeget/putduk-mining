import type { Metadata } from "next";
import Link from "next/link";
import { AuthExperience } from "@/components/auth/auth-experience";

export const metadata: Metadata = {
  title: "접근 권한 안내",
  robots: { follow: false, index: false },
};

export default function ForbiddenPage() {
  return (
    <AuthExperience
      route="/auth/forbidden"
      titleId="auth-forbidden-title"
      eyebrow="접근 권한 안내"
      title="이 화면을 열 수 없어요"
      description="이 계정으로는 이 화면을 열 수 없어요."
      panelTitle="홈으로 돌아가 주세요."
      panelDescription="필요한 화면은 홈에서 다시 열 수 있어요."
      state="error"
    >
      <div className="auth-form__actions">
        <Link className="button button--primary" href="/">
          서비스 홈으로
        </Link>
      </div>
    </AuthExperience>
  );
}
