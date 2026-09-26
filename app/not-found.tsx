import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { StatePanel } from "@/components/ui/states";

export default function NotFound() {
  return (
    <main className="shell">
      <StatePanel
        title="요청한 화면을 찾을 수 없습니다."
        description="주소가 바뀌었거나 아직 공개되지 않은 화면입니다. 홈에서 다시 시작해 주세요."
        action={
          <Link className="button button--primary" href="/">
            홈으로 이동
            <PutdukIcon name="arrow-right" size={18} />
          </Link>
        }
      />
    </main>
  );
}
