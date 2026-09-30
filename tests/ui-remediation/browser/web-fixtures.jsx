import { useState } from "react";
import { AuthForm } from "../../../app/login/auth-form";
import { SignupForm } from "../../../app/signup/signup-form";
import { UpdatePasswordForm } from "../../../app/auth/update-password/update-password-form";
import { MiningCore } from "../../../components/foundation/mining-core";
import { GuidedQuest } from "../../../components/product/guided-quest";
import { WithdrawalForm } from "../../../components/product/withdrawal-form";
import { RouteMotionFixture } from "./route-motion-fixtures";
import "../../../app/globals.css";
import "../../../app/productization.css";

function MotionFixture() {
  const [running, setRunning] = useState(true);
  const [lowPower, setLowPower] = useState(false);
  return (
    <main className="fixture-motion">
      <h1>모션 · 실제 컴포넌트 격리 검사</h1>
      <p>running 속성은 합성 상태입니다. 금액이나 보상은 증가하지 않습니다.</p>
      <div className="fixture-host-controls">
        <label>
          <input
            data-fixture-running
            type="checkbox"
            checked={running}
            onChange={(event) => setRunning(event.target.checked)}
          />{" "}
          합성 running 상태
        </label>
        <label>
          <input
            data-fixture-low-power
            type="checkbox"
            checked={lowPower}
            onChange={(event) => setLowPower(event.target.checked)}
          />{" "}
          저전력 모드
        </label>
      </div>
      <section data-quest-target="world" className="fixture-world">
        <h2>한국 월드 · 테스트</h2>
        <MiningCore running={running} lowPower={lowPower} />
      </section>
      <section data-quest-target="progress" className="fixture-target">
        <h2>확인된 진행 상태 · 합성 값</h2>
        <progress value="40" max="100" aria-label="합성 체험 진행률" />
        <p>40% · 테스트 데이터</p>
      </section>
      <section data-quest-target="action" className="fixture-target">
        <h2>다음 행동</h2>
        <button type="button" className="button button--primary">
          테스트용 읽기 행동
        </button>
      </section>
      <section data-quest-target="boundary" className="fixture-target">
        <h2>체험 값과 실제 지갑</h2>
        <p>합성 값이며 실제 지갑·정산과 연결되지 않습니다.</p>
      </section>
      <GuidedQuest serverStage="ACTIVE" ownerId="motion-fixture" />
      <div className="fixture-scroll-spacer">
        <p>화면 밖 모션 일시정지 검사용 영역</p>
      </div>
    </main>
  );
}

export function Fixture({ kind }) {
  if (kind === "motion") return <MotionFixture />;
  if (kind === "home-motion" || kind === "start-motion")
    return <RouteMotionFixture kind={kind} />;
  return (
    <main className="fixture-panel">
      <h1>
        {{
          login: "로그인 폼",
          signup: "회원가입 폼",
          "update-password": "비밀번호 변경 폼",
          withdrawal: "출금 요청 폼",
        }[kind] ?? "테스트 화면"}
      </h1>
      {kind === "login" ? <AuthForm nextPath="/wallet" /> : null}
      {kind === "signup" ? <SignupForm /> : null}
      {kind === "update-password" ? <UpdatePasswordForm /> : null}
      {kind === "withdrawal" ? (
        <WithdrawalForm
          ownerId="00000000-0000-4000-8000-000000000001"
          account={{
            id: "fixture-wallet",
            availableBalanceAtomic: "125000",
            heldBalanceAtomic: "10000",
          }}
          policies={[
            {
              id: "fixture-krw-policy",
              method: "KRW_BANK",
              allowedDestinations: ["KB", "SHINHAN", "TOSS"],
              feeAtomic: "0",
              minimumAmountAtomic: "1000",
              version: 1,
            },
            {
              id: "fixture-usdt-policy",
              method: "USDT_ADDRESS",
              allowedDestinations: ["TRC20"],
              feeAtomic: "0",
              minimumAmountAtomic: "1000",
              version: 1,
            },
          ]}
          destinations={[]}
        />
      ) : null}
    </main>
  );
}
