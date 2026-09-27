import type { Metadata } from "next";

import { MfaGate } from "@/components/mfa-gate";
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
  return (
    <main className="auth-stage">
      <section className="auth-card auth-card--mfa">
        <p className="eyebrow">MANDATORY AAL2</p>
        <h1>운영자 본인 확인</h1>
        <p>운영 화면은 인증 앱을 통한 두 번째 확인 없이는 열리지 않습니다.</p>
        <MfaGate returnTo={safeReturn} />
      </section>
    </main>
  );
}
