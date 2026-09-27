import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "@/app/signup/signup-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";

export const metadata: Metadata = {
  title: "회원가입",
  robots: { follow: false, index: false },
};

export default function SignupPage() {
  return (
    <main className="auth-page signup-page">
      <section className="auth-page__brand" aria-labelledby="signup-title">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <div>
          <p className="eyebrow">YOUR FIRST MINING WORLD</p>
          <h1 id="signup-title">KOREA에서 시작하는 첫 채굴.</h1>
          <p>가입을 마치면 PUTDUK START가 이어서 안내합니다.</p>
        </div>
        <ul className="auth-trust-list">
          <li>
            <PutdukIcon name="mining" size={19} />
            앱을 닫아도 이어지는 채굴
          </li>
          <li>
            <PutdukIcon name="shield" size={19} />
            최대 5,000원 환영 보상
          </li>
          <li>
            <PutdukIcon name="wallet" size={19} />첫 출금은 입금 없이 가능
          </li>
        </ul>
      </section>
      <section
        className="auth-page__panel signup-page__panel"
        aria-label="회원가입"
      >
        <div className="auth-page__panel-header">
          <p className="eyebrow">CREATE ACCOUNT</p>
          <h2>계정 만들기</h2>
          <p>이름, 생년월일, 휴대전화와 로그인 정보를 입력해 주세요.</p>
        </div>
        <SignupForm />
        <p className="auth-page__legal">
          이미 계정이 있나요? <Link href="/login">로그인</Link>
        </p>
      </section>
    </main>
  );
}
