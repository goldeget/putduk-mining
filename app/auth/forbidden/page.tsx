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
      title="운영 권한이 없습니다"
      description="이 계정에는 관리자 접근 권한이 없습니다."
      panelTitle="승인된 계정이 필요해요."
      panelDescription="관리자 접근 권한은 운영 책임자가 승인합니다."
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
