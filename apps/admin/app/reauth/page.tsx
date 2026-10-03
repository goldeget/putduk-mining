import type { Route } from "next";
import Link from "next/link";

import { AdminAuthEntry } from "@/components/auth/admin-auth-entry";
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
  const mfaHref =
    safe === "/"
      ? "/mfa"
      : (`/mfa?returnTo=${encodeURIComponent(safe)}` as Route);
  const copy =
    reason === "step-up"
      ? "고위험 작업을 위해 인증 앱으로 다시 확인해 주세요."
      : "운영 권한이 바뀌었거나 추가 확인이 필요합니다. 다시 로그인해 주세요.";
  return (
    <AdminAuthEntry
      phase="reauth"
      eyebrow="다시 로그인"
      title="다시 확인해 주세요"
      description={copy}
      footer={<p>다른 운영자의 계정으로 대신 접속할 수 없습니다.</p>}
    >
      <div className="auth-actions">
        <Link className="gold-button" href={loginHref}>
          다시 로그인
        </Link>
        <Link className="ghost-button" href={mfaHref}>
          인증 앱 확인
        </Link>
      </div>
    </AdminAuthEntry>
  );
}
