import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getVerifiedRecoveryAuthorization } from "@/app/auth/update-password/recovery-proof";
import { UpdatePasswordForm } from "@/app/auth/update-password/update-password-form";
import { AuthExperience } from "@/components/auth/auth-experience";

export const metadata: Metadata = {
  title: "새 비밀번호 설정",
  robots: { follow: false, index: false },
};

export default async function UpdatePasswordPage() {
  const authorization = await getVerifiedRecoveryAuthorization();
  if (!authorization) redirect("/recover");

  return (
    <AuthExperience
      route="/auth/update-password"
      titleId="update-password-title"
      eyebrow="새 비밀번호"
      title="새로운 비밀번호로 안전하게."
      description="확인 링크로 열린 이 화면에서 새 비밀번호를 설정해 주세요."
      panelTitle="새 비밀번호 설정"
      panelDescription="새 비밀번호를 입력하고 확인해 주세요."
      footer={
        <>
          <Link href="/recover">재설정 안내 다시 받기</Link>
          {" · "}
          <Link href="/login">로그인으로 돌아가기</Link>
        </>
      }
    >
      <UpdatePasswordForm />
    </AuthExperience>
  );
}
