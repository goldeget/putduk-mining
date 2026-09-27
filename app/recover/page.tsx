import type { Metadata } from "next";
import Link from "next/link";

import { RecoveryForm } from "@/app/recover/recovery-form";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
  robots: { follow: false, index: false },
};

export default function RecoverPage() {
  return (
    <main className="auth-page auth-page--compact">
      <section className="auth-page__brand" aria-labelledby="recover-title">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <div>
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h1 id="recover-title">다시 안전하게 이어가세요.</h1>
          <p>가입할 때 등록한 복구 이메일로 본인 확인 안내를 보냅니다.</p>
        </div>
      </section>
      <section className="auth-page__panel" aria-label="비밀번호 재설정 요청">
        <div className="auth-page__panel-header">
          <p className="eyebrow">RESET PASSWORD</p>
          <h2>비밀번호 재설정</h2>
          <p>계정 존재 여부와 관계없이 같은 안내를 표시합니다.</p>
        </div>
        <RecoveryForm />
        <p className="auth-page__legal">
          <Link href="/login">로그인으로 돌아가기</Link>
        </p>
      </section>
    </main>
  );
}
