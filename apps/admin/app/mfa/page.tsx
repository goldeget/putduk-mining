import { ThemeControl } from "../../../../components/system/theme-control";
import type { Metadata } from "next";

import { MfaGate } from "@/components/mfa-gate";
import { prepareAdminMfaOnServer } from "@/lib/auth/mfa-prepare";
import { requireAdminIdentity } from "@/lib/auth/principal";
import { safeAdminReturnPath } from "@/lib/auth/return-path";

export const metadata: Metadata = { title: "다중 인증" };
export const dynamic = "force-dynamic";

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const safeReturn = safeAdminReturnPath(returnTo);
  await requireAdminIdentity(safeReturn);
  const initialPrepare = await prepareAdminMfaOnServer();
  return (
    <main className="auth-stage">
      <section className="auth-card auth-card--mfa">
        <ThemeControl />
        <p className="eyebrow">두 번째 보안 확인</p>
        <h1>운영자 본인 확인</h1>
        <p>운영 화면은 인증 앱을 통한 두 번째 확인 없이는 열리지 않습니다.</p>
        <MfaGate initialPrepare={initialPrepare} returnTo={safeReturn} />
      </section>
    </main>
  );
}
