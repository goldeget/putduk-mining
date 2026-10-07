import { createRoot } from "react-dom/client";
import { AdminNavigation } from "../../components/admin-navigation";
import { ScreenGuide } from "../../components/assistant/screen-guide";
import { TodayView } from "../../components/today/today-view";
import { OperationsView } from "../../components/operations/operations-view";
import { MemberDirectory } from "../../components/members/member-directory";
import { buildTodaySnapshot } from "../../app/(control)/_lib/today-snapshot";
import {
  isOperationSection,
  operationSections,
} from "../../lib/operations/registry";
import "../../app/globals.css";

const params = new URLSearchParams(location.search);
const section = params.get("section") ?? "today";
const state = params.get("state") ?? "loaded";
const empty = state === "empty";
const unavailable = state === "partial";
const observedAt = "2026-10-07T01:00:00Z";
document.documentElement.dataset.theme = params.get("theme") ?? "dark";
const style = document.createElement("style");
style.textContent =
  '@font-face{font-family:"AdminFixture";src:url("/fixture-font.woff2") format("woff2");font-weight:45 930;font-display:swap}:root{--font-putduk:"AdminFixture"}';
document.head.append(style);
const ready = (count) => ({ count: empty ? 0 : count, error: null });
const today = buildTodaySnapshot({
  krwDeposits: ready(2),
  usdtDeposits: ready(1),
  krwWithdrawals: ready(3),
  usdtWithdrawals: ready(1),
  kyc: unavailable
    ? { count: null, error: { message: "SYNTHETIC_READ_FAILURE" } }
    : ready(1),
  mismatches: ready(1),
  failedJobs: ready(2),
  safePaused: ready(0),
  users: ready(42),
  trials: ready(8),
  audits: { data: [], error: null },
  observedAt: new Date(observedAt),
});
const snapshot = isOperationSection(section)
  ? {
      section,
      observedAt,
      panels:
        section === "support"
          ? []
          : [
              {
                key: section,
                title: operationSections[section].title,
                state: unavailable ? "unavailable" : "ready",
                count: unavailable ? null : empty ? 0 : 2,
                rows:
                  unavailable || empty
                    ? []
                    : [
                        {
                          id: "00000000-0000-4000-8000-000000000001",
                          title: "합성 기록 · 실제 회원 데이터 아님",
                          status: "확인 필요",
                          at: observedAt,
                          detail:
                            "실제 컴포넌트의 화면·동작을 검증해요. 서버 조작은 차단되어 있어요.",
                          memberId: null,
                        },
                        {
                          id: "00000000-0000-4000-8000-000000000002",
                          title: "두 번째 합성 기록",
                          status: "검토 중",
                          at: observedAt,
                          detail: null,
                          memberId: null,
                        },
                      ],
              },
            ],
    }
  : null;
window.fetch = async () => {
  throw new Error("No API calls in isolated Admin UI QA");
};
createRoot(document.getElementById("fixture-root")).render(
  <div className="control-shell">
    <aside className="control-rail">
      <p className="brand-lockup">퍼뜩 · 화면 검증</p>
      <AdminNavigation role={params.get("role") ?? "ADMIN"} />
    </aside>
    <div className="control-workspace">
      <header className="control-topbar">
        <span>합성 데이터 · 인증 E2E 아님</span>
        <ScreenGuide role={params.get("role") ?? "ADMIN"} />
      </header>
      <main className="control-main">
        {section === "today" ? (
          <TodayView snapshot={today} />
        ) : section === "members" ? (
          <MemberDirectory
            members={
              unavailable || empty
                ? []
                : [
                    {
                      userId: "00000000-0000-4000-8000-000000000001",
                      name: "합성 테스트 회원",
                      joinedAt: observedAt,
                    },
                  ]
            }
            unavailable={unavailable}
            query=""
            invalidReference={false}
          />
        ) : snapshot ? (
          <OperationsView snapshot={snapshot} />
        ) : (
          <p>등록되지 않은 검증 화면</p>
        )}
      </main>
    </div>
  </div>,
);
