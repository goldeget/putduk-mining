import type { Route } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const message =
    code === "STEP_UP_REQUIRED"
      ? "고위험 작업입니다. 인증 앱으로 다시 확인한 뒤 시도해 주세요."
      : code === "ROLE_FORBIDDEN"
        ? "현재 역할로는 이 작업을 할 수 없습니다."
        : "이 운영 화면이나 명령을 실행할 권한이 없습니다.";

  return (
    <main className="auth-stage">
      <section className="auth-card">
        <p className="eyebrow">COMMAND DENIED</p>
        <h1>권한이 없습니다</h1>
        <p>{message}</p>
        <div className="auth-actions">
          <Link className="gold-button" href={"/" as Route}>
            오늘의 퍼뜩
          </Link>
          <Link className="ghost-button" href={"/reauth?reason=step-up" as Route}>
            다시 확인
          </Link>
        </div>
        <footer>거절된 명령은 보안 기록에 남습니다. 존재 여부는 과도하게 드러내지 않습니다.</footer>
      </section>
    </main>
  );
}
