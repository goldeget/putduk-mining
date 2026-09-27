import type { Metadata } from "next";
import Link from "next/link";

import { FindIdForm } from "@/app/find-id/find-id-form";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "아이디 찾기",
  robots: { follow: false, index: false },
};

export default function FindIdPage() {
  return (
    <main className="auth-page auth-page--compact">
      <section className="auth-page__brand" aria-labelledby="find-id-title">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <div>
          <p className="eyebrow">FIND LOGIN ID</p>
          <h1 id="find-id-title">내 계정으로 돌아오는 안전한 길.</h1>
          <p>
            복구 이메일의 확인 링크를 연 뒤 계정 화면에서 로그인 아이디를 확인할
            수 있어요.
          </p>
        </div>
      </section>
      <section className="auth-page__panel" aria-label="아이디 찾기">
        <div className="auth-page__panel-header">
          <p className="eyebrow">ACCOUNT HELP</p>
          <h2>아이디 찾기</h2>
          <p>계정 존재 여부는 이 화면에서 공개하지 않습니다.</p>
        </div>
        <FindIdForm />
        <p className="auth-page__legal">
          <Link href="/login">로그인으로 돌아가기</Link>
        </p>
      </section>
    </main>
  );
}
