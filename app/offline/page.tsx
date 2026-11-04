import Link from "next/link";
export default function OfflinePage() {
  return (
    <main
      data-ui-state="offline"
      data-ui-ready="/offline"
      style={{
        maxWidth: 560,
        margin: "12vh auto",
        padding: 32,
        color: "#e9f1fc",
        background: "#0c1727",
        borderRadius: 24,
      }}
    >
      <p style={{ color: "#73efc3", letterSpacing: 4 }}>WORKROOM</p>
      <h1>연결을 잠시 기다리고 있어요.</h1>
      <p>
        진행 중인 회차는 서버 시간을 기준으로 이어집니다. 인터넷이 연결되면 최신
        상태와 결과를 확인해 주세요.
      </p>
      <p>연결이 없는 동안 화면에 표시된 값은 최신 상태가 아닐 수 있습니다.</p>
      <Link href="/workroom">내 워크룸 다시 열기</Link>
    </main>
  );
}
