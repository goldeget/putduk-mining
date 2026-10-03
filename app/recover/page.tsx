import type { Metadata } from "next";
import Link from "next/link";

import { RecoveryForm } from "@/app/recover/recovery-form";
import { AuthExperience } from "@/components/auth/auth-experience";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
  robots: { follow: false, index: false },
};

export default function RecoverPage() {
  return (
    <AuthExperience
      route="/recover"
      titleId="recover-title"
      eyebrow="계정 복구"
      title="비밀번호 다시 설정하기"
      description="복구 이메일로 재설정 안내를 받아요. 링크를 열면 새 비밀번호를 설정할 수 있어요."
      panelTitle="비밀번호 재설정"
      panelDescription="가입할 때 등록한 복구 이메일을 입력해 주세요."
      footer={<Link href="/login">로그인으로 돌아가기</Link>}
    >
      <RecoveryForm />
    </AuthExperience>
  );
}
