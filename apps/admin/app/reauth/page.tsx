import { ThemeControl } from "../../../../components/system/theme-control";
import type { Route } from "next";
import Link from "next/link";

import { safeAdminReturnPath } from "@/lib/auth/return-path";

export const dynamic = "force-dynamic";

export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; reason?: string }>;
}) {
  const { returnTo, reason } = await searchParams;
  const safe = safeAdminReturnPath(returnTo);
  const loginHref =
    safe === "/"
      ? "/login"
      : (`/login?returnTo=${encodeURIComponent(safe)}` as Route);

  const copy =
    reason === "step-up"
      ? "고위험 작업을 위해 인증 앱으로 다시 확인해 주세요."
      : "운영 권한이 바뀌었거나 추가 확인이 필요합니다. 다시 로그인해 주세요.";

  return (
    <main className="auth-stage">
      <section className="auth-card">
        <ThemeControl />
        <p className="eyebrow">다시 로그인</p>
        <h1>다시 확인해 주세요</h1>
        <p>{copy}</p>
        <div className="auth-actions">
          <Link className="gold-button" href={loginHref}>
            다시 로그인
          </Link>
          <Link className="ghost-button" href={"/mfa" as Route}>
            인증 앱 확인
          </Link>
        </div>
        <footer>가장하기(impersonation)는 제공하지 않습니다.</footer>
      </section>
    </main>
  );
}
