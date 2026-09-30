import type { Metadata } from "next";
import Link from "next/link";

import { FindIdForm } from "@/app/find-id/find-id-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeControl } from "@/components/system/theme-control";

export const metadata: Metadata = {
  title: "아이디 찾기",
  robots: { follow: false, index: false },
};

export default function FindIdPage() {
  return (
    <main
      className="auth-page auth-page--compact"
      data-ui-ready="/find-id"
      data-ui-state="loaded"
    >
      <section className="auth-page__brand" aria-labelledby="find-id-title">
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
          <p className="eyebrow">로그인 아이디 찾기</p>
          <h1 id="find-id-title">내 계정으로 돌아오는 안전한 길.</h1>
          <p>
            복구 이메일의 확인 링크를 연 뒤 계정 화면에서 로그인 아이디를 확인할
            수 있어요.
          </p>
        </div>
      </section>
      <section className="auth-page__panel" aria-label="아이디 찾기">
        <div className="auth-page__panel-header">
          <p className="eyebrow">계정 도움말</p>
          <h2>아이디 찾기</h2>
          <p>등록한 복구 이메일로 아이디 확인 링크를 받아요.</p>
        </div>
        <FindIdForm />
        <p className="auth-page__legal">
          <Link href="/login">로그인으로 돌아가기</Link>
        </p>
      </section>
    </main>
  );
}
