import type { Metadata } from "next";
import Link from "next/link";

import { FindIdForm } from "@/app/find-id/find-id-form";
import { AuthExperience } from "@/components/auth/auth-experience";

export const metadata: Metadata = {
  title: "아이디 찾기",
  robots: { follow: false, index: false },
};

export default function FindIdPage() {
  return (
    <AuthExperience
      route="/find-id"
      titleId="find-id-title"
      eyebrow="계정 도움말"
      title="내 계정으로 돌아오는 안전한 길."
      description="이메일의 확인 링크를 열면 계정 화면에서 로그인 아이디를 확인할 수 있어요."
      panelTitle="아이디 찾기"
      panelDescription="가입할 때 등록한 복구 이메일을 입력해 주세요."
      footer={<Link href="/login">로그인으로 돌아가기</Link>}
    >
      <FindIdForm />
    </AuthExperience>
  );
}
