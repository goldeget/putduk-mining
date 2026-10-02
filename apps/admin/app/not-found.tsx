import { ThemeControl } from "../../../components/system/theme-control";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-stage">
      <section className="auth-card">
        <ThemeControl />
        <p className="eyebrow">운영 화면 안내</p>
        <h1>이 운영 화면은 존재하지 않습니다.</h1>
        <p>주소를 확인하거나 오늘의 운영 화면으로 돌아가세요.</p>
        <Link className="gold-button" href="/">
          오늘의 퍼뜩
        </Link>
      </section>
    </main>
  );
}
