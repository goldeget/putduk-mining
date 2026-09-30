import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { ThemeControl } from "../../../components/system/theme-control";
import { ThemeRuntime } from "../../../components/system/theme-runtime";
import { fixtureState, installFixtureBoundary } from "./safety";
import "./fixture.css";

installFixtureBoundary();
const parameters = new URLSearchParams(window.location.search);
const kind = parameters.get("fixture") ?? "motion";
const { Fixture } = kind.startsWith("admin-")
  ? await import("./admin-fixtures")
  : await import("./web-fixtures");

function MountedFixture() {
  useEffect(() => {
    fixtureState.ready = true;
  }, []);
  return (
    <>
      <ThemeRuntime />
      <header className="fixture-toolbar">
        <p>
          <strong>로컬 UI 테스트</strong> · 합성 데이터 · 서버 조작 차단 · 인증
          E2E 아님
        </p>
        <ThemeControl />
        <nav aria-label="테스트 화면">
          {[
            ["motion", "모션"],
            ["login", "로그인"],
            ["signup", "회원가입"],
            ["update-password", "비밀번호 변경"],
            ["withdrawal", "출금 폼"],
            ["admin-mfa", "MFA"],
            ["admin-step-up", "작업 확인"],
            ["admin-kyc", "KYC"],
            ["admin-today", "오늘 운영"],
          ].map(([value, label]) => (
            <a
              key={value}
              href={`?fixture=${value}`}
              aria-current={kind === value ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      <div data-fixture-kind={kind}>
        <Fixture kind={kind} />
      </div>
    </>
  );
}

createRoot(document.getElementById("fixture-root")).render(<MountedFixture />);
