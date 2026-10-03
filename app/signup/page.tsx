import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "@/app/signup/signup-form";
import { AuthExperience } from "@/components/auth/auth-experience";

export const metadata: Metadata = {
  title: "회원가입",
  robots: { follow: false, index: false },
};

export default function SignupPage() {
  return (
    <AuthExperience
      route="/signup"
      titleId="signup-title"
      eyebrow="나의 첫 채굴"
      title="나의 첫 채굴을 시작해요."
      description="가입을 마치면 첫 채굴을 안내해 드려요."
      panelTitle="계정 만들기"
      panelDescription="이름과 연락처를 입력한 뒤 로그인 정보를 정해 주세요."
      spacious
      footer={
        <p>
          이미 계정이 있나요? <Link href="/login">로그인</Link>
        </p>
      }
    >
      <SignupForm />
    </AuthExperience>
  );
}
