import Link from "next/link";

import { StatePanel } from "@/components/ui/states";

export default function ForbiddenPage() {
  return (
    <main className="shell">
      <StatePanel
        tone="error"
        title="운영 권한이 없습니다"
        description="이 계정에는 관리자 접근 권한이 없습니다. 권한은 운영 책임자가 승인합니다."
        action={
          <Link className="button button--secondary" href="/">
            서비스 홈으로
          </Link>
        }
      />
    </main>
  );
}
