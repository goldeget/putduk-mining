import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getVerifiedRecoveryAuthorization } from "@/app/auth/update-password/recovery-proof";
import { UpdatePasswordForm } from "@/app/auth/update-password/update-password-form";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "새 비밀번호 설정",
  robots: { follow: false, index: false },
};

export default async function UpdatePasswordPage() {
  const authorization = await getVerifiedRecoveryAuthorization();
  if (!authorization) {
    redirect("/recover");
  }

  return (
    <main className="auth-page auth-page--compact">
      <section
        className="auth-page__brand"
        aria-labelledby="update-password-title"
      >
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <div>
          <p className="eyebrow">NEW PASSWORD</p>
          <h1 id="update-password-title">새로운 비밀번호로 안전하게.</h1>
          <p>확인 링크로 열린 이 화면에서 새 비밀번호를 설정해 주세요.</p>
        </div>
      </section>
      <section className="auth-page__panel" aria-label="새 비밀번호 설정">
        <div className="auth-page__panel-header">
          <p className="eyebrow">SECURE UPDATE</p>
          <h2>새 비밀번호 설정</h2>
          <p>비밀번호 관리자의 생성·저장·붙여넣기를 지원합니다.</p>
        </div>
        <UpdatePasswordForm />
        <p className="auth-page__legal">
          <Link href="/recover">재설정 안내 다시 받기</Link>
          {" · "}
          <Link href="/login">로그인으로 돌아가기</Link>
        </p>
      </section>
    </main>
  );
}
