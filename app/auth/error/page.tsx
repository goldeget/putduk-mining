import Link from "next/link";
import { ThemeControl } from "@/components/system/theme-control";

import { StatePanel } from "@/components/ui/states";

export default function AuthErrorPage() {
  return (
    <main
      className="shell terminal-page"
      data-ui-ready="/auth/error"
      data-ui-state="error"
    >
      <div className="terminal-page__tools">
        <ThemeControl />
      </div>
      <StatePanel
        headingLevel={1}
        tone="error"
        title="계정 확인을 완료하지 못했습니다"
        description="링크가 만료됐거나 계정 초기화가 지연됐을 수 있습니다. 다시 로그인해 주세요."
        action={
          <Link
            className="button button--primary"
            href={{ pathname: "/login" }}
          >
            로그인으로 돌아가기
          </Link>
        }
      />
    </main>
  );
}
