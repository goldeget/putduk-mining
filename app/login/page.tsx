import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/app/login/auth-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { safeProtectedReturnPath } from "@/lib/auth/return-path";

export const metadata: Metadata = {
  title: "로그인",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const requestedNext = (await searchParams).next;
  const nextPath = safeProtectedReturnPath(requestedNext);
  const isAdminDestination = nextPath.startsWith("/admin");

  return (
    <main className="auth-page">
      <section className="auth-page__brand" aria-labelledby="auth-title">
        <Link className="brand-lockup" href="/" aria-label="퍼뜩 채굴 홈">
          <BrandMark title="" />
          <span>
            <strong>PUTDUK</strong>
            <small>MINING</small>
          </span>
        </Link>
        <div>
          <p className="eyebrow">SECURE ENTRY</p>
          <h1 id="auth-title">복잡한 시스템은 안쪽에, 시작은 분명하게.</h1>
          <p>
            계정과 자산 정보는 서버에서 검증됩니다. 로그인 후 PUTDUK START의 첫
            채굴 흐름으로 이어집니다.
          </p>
        </div>
        <ul className="auth-trust-list">
          <li>
            <PutdukIcon name="shield" size={19} />
            서버 검증 세션
          </li>
          <li>
            <PutdukIcon name="pulse" size={19} />
            원장 기반 자산 기록
          </li>
          <li>
            <PutdukIcon name="clock" size={19} />
            서버 시간 기준 정산
          </li>
        </ul>
      </section>
      <section className="auth-page__panel" aria-label="계정 로그인 및 가입">
        <div className="auth-page__panel-header">
          <p className="eyebrow">ACCOUNT</p>
          <h2>{isAdminDestination ? "운영자 로그인" : "계정으로 시작하기"}</h2>
          <p>가입과 로그인 모두 동일한 안전한 계정 경계를 사용합니다.</p>
        </div>
        <AuthForm nextPath={nextPath} />
        <p className="auth-page__legal">
          가입을 진행하면 서비스 운영 원칙과 개인정보 처리 기준에 동의한 것으로
          간주됩니다.
        </p>
      </section>
    </main>
  );
}
