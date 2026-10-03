import Link from "next/link";
import { AdminAuthEntry } from "@/components/auth/admin-auth-entry";

export const dynamic = "force-dynamic";

export default function SessionExpiredPage() {
  return (
    <AdminAuthEntry
      phase="session-expired"
      eyebrow="세션 종료"
      title="세션이 만료되었습니다"
      description="보안을 위해 접속을 종료했어요. 다시 로그인해 주세요."
      footer={<p>만료되거나 종료된 접속 기록은 안전하게 보관합니다.</p>}
    >
      <div className="auth-actions">
        <Link className="gold-button" href="/login">
          다시 로그인
        </Link>
      </div>
    </AdminAuthEntry>
  );
}
