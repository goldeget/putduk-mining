import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-stage">
      <section className="auth-card">
        <p className="eyebrow">404 · CONTROL PLANE</p>
        <h1>이 운영 화면은 존재하지 않습니다.</h1>
        <p>주소를 확인하거나 오늘의 운영 화면으로 돌아가세요.</p>
        <Link className="gold-button" href="/">
          오늘의 퍼뜩
        </Link>
      </section>
    </main>
  );
}
