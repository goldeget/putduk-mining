import { offlineShellStyles } from "./offline-shell-styles";

export const metadata = { title: "오프라인" };

export default function OfflinePage() {
  return (
    <main
      className="putduk-offline"
      data-ui-ready="/offline"
      data-ui-state="offline"
    >
      <style>{offlineShellStyles}</style>
      <section className="putduk-offline__card" aria-labelledby="offline-title">
        <span className="putduk-offline__brand">퍼뜩 채굴</span>
        {/* A cached public image and native link work without JavaScript or external styles. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/mascot/putduk-miner-384-v1.webp"
          width="160"
          height="160"
          alt=""
        />
        <h1 id="offline-title">잠시 연결이 끊겼어요.</h1>
        <p>
          앱을 닫아도 채굴은 계속돼요. 연결되면 최신 결과를 다시 확인할 수
          있어요.
        </p>
        <p>지금은 입금·출금과 계정 변경을 진행할 수 없어요.</p>
        {/* Native navigation intentionally works when no Next.js chunks or hydration are available. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/home">
          연결 다시 확인
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12h14m-6-6 6 6-6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </section>
    </main>
  );
}
