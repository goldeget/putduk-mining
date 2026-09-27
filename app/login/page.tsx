import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/app/login/auth-form";
import { BrandMark } from "@/components/brand/brand-mark";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { ThemeControl } from "@/components/system/theme-control";
import { safeProtectedReturnPath } from "@/lib/auth/return-path";

export const metadata: Metadata = {
  title: "로그인",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    logout?: string;
    next?: string;
    password?: string;
  }>;
}) {
  const params = await searchParams;
  const requestedNext = params.next;
  const nextPath = safeProtectedReturnPath(requestedNext);
  const statusMessage =
    params.password === "updated"
      ? "비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요."
      : params.logout === "global"
        ? "모든 기기에서 안전하게 로그아웃했습니다."
        : params.logout === "local"
          ? "이 기기에서 로그아웃했습니다."
          : null;

  return (
    <main className="auth-page">
      <section className="auth-page__brand" aria-labelledby="auth-title">
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
          <p className="eyebrow">SECURE ENTRY</p>
          <h1 className="ko-heading" id="auth-title">
            나의 채굴로 돌아가기
          </h1>
          <p>로그인하면 채굴 상태와 지갑을 이어서 확인할 수 있어요.</p>
        </div>
        <ul className="auth-trust-list">
          <li>
            <PutdukIcon name="shield" size={19} />
            안전한 계정 확인
          </li>
          <li>
            <PutdukIcon name="pulse" size={19} />
            확인된 내역만 잔액 반영
          </li>
          <li>
            <PutdukIcon name="clock" size={19} />
            앱을 닫아도 이어지는 채굴
          </li>
        </ul>
      </section>
      <section className="auth-page__panel" aria-label="계정 로그인">
        <div className="auth-page__panel-header">
          <p className="eyebrow">ACCOUNT</p>
          <h2 className="ko-heading">다시 만나 반가워요.</h2>
          <p className="ko-copy">아이디 또는 복구 이메일로 로그인해 주세요.</p>
        </div>
        {statusMessage ? (
          <p
            className="auth-form__message auth-form__message--success"
            role="status"
          >
            {statusMessage}
          </p>
        ) : null}
        <AuthForm nextPath={nextPath} />
        <p className="auth-page__legal ko-copy">
          로그인에 문제가 있어도 계정 존재 여부는 알려 드리지 않습니다.
        </p>
      </section>
    </main>
  );
}
