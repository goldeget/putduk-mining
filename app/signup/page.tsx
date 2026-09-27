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
          <h1 id="signup-title">KOREA에서 시작하는 나만의 첫 채굴.</h1>
          <p>
            가입을 마치면 PUTDUK START가 핵심 흐름을 안내합니다. 체험 값과 실제
            지갑은 자격 확인과 전환 전까지 분리됩니다.
          </p>
        </div>
        <ul className="auth-trust-list">
          <li>
            <PutdukIcon name="mining" size={19} />
            서버 시간 기준 채굴
          </li>
          <li>
            <PutdukIcon name="shield" size={19} />
            최대 5,000원 자격 확인
          </li>
          <li>
            <PutdukIcon name="wallet" size={19} />
            해당 첫 출금은 사전 입금 불필요
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
          <p>본인 확인과 계정 복구에 필요한 정보를 정확히 입력해 주세요.</p>
        </div>
        <SignupForm />
        <p className="auth-page__legal">
          이미 계정이 있나요? <Link href="/login">로그인</Link>
        </p>
      </section>
    </main>
  );
}
