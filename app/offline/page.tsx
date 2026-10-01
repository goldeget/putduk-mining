import Link from "next/link";
import { ThemeControl } from "@/components/system/theme-control";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { StatePanel } from "@/components/ui/states";

export const metadata = { title: "오프라인" };

export default function OfflinePage() {
  return (
    <main
      className="shell terminal-page"
      data-ui-ready="/offline"
      data-ui-state="offline"
    >
      <div className="terminal-page__tools">
        <ThemeControl />
      </div>
      <StatePanel
        headingLevel={1}
        tone="offline"
        title="현재 네트워크에 연결되지 않았습니다."
        description="연결이 복구되면 최신 채굴·정산 상태를 다시 불러옵니다. 오프라인 화면의 수치는 자산 근거로 사용하지 않습니다."
        action={
          <Link className="button button--secondary" href="/">
            연결 다시 확인
            <PutdukIcon name="pulse" size={18} />
          </Link>
        }
      />
    </main>
  );
}
