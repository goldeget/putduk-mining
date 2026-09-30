import { ThemeControl } from "../../../../components/system/theme-control";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SessionExpiredPage() {
  return (
    <main className="auth-stage">
      <section className="auth-card">
        <ThemeControl />
        <p className="eyebrow">세션 종료</p>
        <h1>세션이 만료되었습니다</h1>
        <p>보안을 위해 다시 로그인해 주세요.</p>
        <Link className="gold-button" href="/login">
          다시 로그인
        </Link>
        <footer>만료·강제 종료된 세션은 감사 대상입니다.</footer>
      </section>
    </main>
  );
}
