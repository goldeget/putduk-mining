import type { Metadata } from "next";
import Link from "next/link";

import { RecoveryForm } from "@/app/recover/recovery-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeControl } from "@/components/system/theme-control";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
  robots: { follow: false, index: false },
};

export default function RecoverPage() {
  return (
    <main
      className="auth-page auth-page--compact"
      data-ui-ready="/recover"
      data-ui-state="loaded"
    >
      <section className="auth-page__brand" aria-labelledby="recover-title">
        <div className="auth-page__top">
          <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
            <BrandMark title="" />
            <span>
              <strong>PUTDUK</strong>
              <small>MINING</small>
            </span>
          </Link>
          <ThemeControl />
        </div>
        <div>
          <p className="eyebrow">계정 복구</p>
          <h1 id="recover-title">비밀번호 다시 설정하기</h1>
          <p>가입할 때 등록한 복구 이메일로 안내를 보냅니다.</p>
        </div>
      </section>
      <section className="auth-page__panel" aria-label="비밀번호 재설정 요청">
        <div className="auth-page__panel-header">
          <p className="eyebrow">비밀번호 재설정</p>
          <h2>비밀번호 재설정</h2>
          <p>등록한 복구 이메일을 입력해 주세요.</p>
        </div>
        <RecoveryForm />
        <p className="auth-page__legal">
          <Link href="/login">로그인으로 돌아가기</Link>
        </p>
      </section>
    </main>
  );
}
