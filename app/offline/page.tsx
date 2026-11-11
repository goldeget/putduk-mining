import Link from "next/link";
import { WorkroomTerminal } from "@/components/workroom/terminal";
export default function OfflinePage() {
  return (
    <WorkroomTerminal
      state="offline"
      ready="/offline"
      title="연결을 잠시 기다리고 있어요."
      description={
        <>
          <p>
            진행 중인 회차는 서버 시간을 기준으로 이어집니다. 인터넷이 연결되면
            최신 상태와 결과를 확인해 주세요.
          </p>
          <p>
            연결이 없는 동안 화면에 표시된 값은 최신 상태가 아닐 수 있습니다.
          </p>
        </>
      }
      action={<Link href="/workroom">내 워크룸 다시 열기</Link>}
    />
  );
}
