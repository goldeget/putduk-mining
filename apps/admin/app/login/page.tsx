import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminAuthEntry } from "@/components/auth/admin-auth-entry";
import { LoginForm } from "@/components/login-form";
import { getAdminIdentityForLoginPage } from "@/lib/auth/principal";
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
  const identity = await getAdminIdentityForLoginPage();
  if (identity?.role) {
    const destination =
      identity.aal === "aal2"
        ? safeReturn
        : `/mfa?returnTo=${encodeURIComponent(safeReturn)}`;
    redirect(destination as Route);
  }
  return (
    <AdminAuthEntry
      phase="login"
      eyebrow="운영자 전용"
      title="운영자 전용 보안 로그인"
      description="승인된 운영자 계정으로 로그인해 주세요. 인증 앱 확인 후 운영 화면으로 이어집니다."
      footer={
        <p>
          접속이 종료됐다면{" "}
          <Link className="text-link" href={"/session-expired" as Route}>
            안내 화면
          </Link>
          에서 다시 로그인할 수 있어요.
        </p>
      }
    >
      {denied ? (
        <p className="form-error" role="alert">
          운영 권한이 없거나 세션이 거절되었습니다. 다시 시도해 주세요.
        </p>
      ) : null}
      <LoginForm returnTo={safeReturn} />
    </AdminAuthEntry>
  );
}
