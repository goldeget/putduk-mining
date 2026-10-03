import type { Metadata } from "next";

import { AdminAuthEntry } from "@/components/auth/admin-auth-entry";
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
    <AdminAuthEntry
      phase="mfa"
      eyebrow="두 번째 보안 확인"
      title="운영자 본인 확인"
      description="인증 앱의 코드를 입력해 주세요. 확인을 마치면 운영 화면으로 이어집니다."
      footer={<p>등록 키와 인증 코드는 다른 사람에게 공유하지 마세요.</p>}
    >
      <MfaGate initialPrepare={initialPrepare} returnTo={safeReturn} />
    </AdminAuthEntry>
  );
}
