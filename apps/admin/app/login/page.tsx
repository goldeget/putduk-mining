import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeControl } from "../../../../components/system/theme-control";

import { LoginForm } from "@/components/login-form";
import { getAdminIdentity } from "@/lib/auth/principal";
import { safeAdminReturnPath } from "@/lib/auth/return-path";

export const metadata: Metadata = { title: "운영자 로그인" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; denied?: string }>;
}) {
  const { returnTo, denied } = await searchParams;
  const safeReturn = safeAdminReturnPath(returnTo);
  const identity = await getAdminIdentity();
  if (identity?.role) {
    const destination =
      identity.aal === "aal2"
        ? safeReturn
        : `/mfa?returnTo=${encodeURIComponent(safeReturn)}`;
    redirect(destination as Route);
  }
  return (
    <main className="auth-stage" data-ui-ready="/login" data-ui-state="loaded">
      <section className="auth-card">
        <div className="brand-lockup">
          <span className="brand-symbol">P</span>
          <strong>퍼뜩</strong>
          <small>운영자 보안 접속</small>
        </div>
        <ThemeControl />
        <p className="eyebrow">운영자 전용</p>
        <h1>운영자 전용 보안 로그인</h1>
        <p>일반 회원 계정과 분리된 운영자 권한 및 다중 인증을 확인합니다.</p>
        {denied ? (
          <p className="form-error" role="alert">
            운영 권한이 없거나 세션이 거절되었습니다. 다시 시도해 주세요.
          </p>
        ) : null}
        <LoginForm returnTo={safeReturn} />
        <p className="form-note">
          세션이 만료되면{" "}
          <Link className="text-link" href={"/session-expired" as Route}>
            안내 화면
          </Link>
          으로 이동합니다.
        </p>
        <footer>접근 시도와 고위험 작업은 보안 기록 및 감사 대상입니다.</footer>
      </section>
    </main>
  );
}
