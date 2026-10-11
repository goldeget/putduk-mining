import { useState } from "react";
import { MfaGate } from "../../../apps/admin/components/mfa-gate";
import { StepUpTokenField } from "../../../apps/admin/components/step-up-token-field";
import { KycReviewForm } from "../../../apps/admin/app/(control)/kyc/review-form";
import { TodayView } from "../../../apps/admin/components/today/today-view";
import { buildTodaySnapshot } from "../../../apps/admin/app/(control)/_lib/today-snapshot";
import { fixtureState } from "./safety";
import "../../../apps/admin/app/globals.css";

function todaySnapshot(state) {
  const ready = (count) => ({
    count: state === "empty" ? 0 : count,
    error: null,
  });
  return buildTodaySnapshot({
    krwDeposits: ready(1),
    usdtDeposits: ready(2),
    krwWithdrawals: ready(3),
    usdtWithdrawals: ready(1),
    kyc:
      state === "partial"
        ? { count: null, error: { message: "LOCAL_FIXTURE_READ_FAILURE" } }
        : ready(4),
    mismatches: ready(1),
    failedJobs: ready(2),
    safePaused: ready(1),
    users: ready(42),
    trials: ready(8),
    audits: {
      error: null,
      data:
        state === "empty"
          ? []
          : [
              {
                id: "fixture-audit-1",
                action: "REVIEW_KYC",
                targetType: "kyc_case",
                reason: null,
                createdAt: "2026-09-30T09:00:00Z",
              },
              {
                id: "fixture-audit-2",
                action: "ACK_RECONCILIATION_MISMATCH",
                targetType: "reconciliation_mismatch",
                reason: null,
                createdAt: "2026-09-30T08:59:00Z",
              },
            ],
    },
    observedAt: new Date("2026-09-30T09:00:00Z"),
  });
}

export function Fixture({ kind }) {
  const [sdkMode, setSdkMode] = useState(fixtureState.sdkMode);
  const [networkMode, setNetworkMode] = useState(fixtureState.networkMode);
  const [todayState, setTodayState] = useState("populated");
  const [evidenceAvailable, setEvidenceAvailable] = useState(true);
  const [commandFamily, setCommandFamily] = useState("KYC_REVIEW");
  const [parentPending, setParentPending] = useState(false);
  return (
    <main
      className={`fixture-panel ${kind === "admin-today" ? "fixture-panel--wide" : ""}`}
    >
      <h1>운영자 실제 컴포넌트 · 격리 테스트</h1>
      <div className="fixture-host-controls">
        <label>
          로컬 SDK 응답
          <select
            value={sdkMode}
            onChange={(event) => {
              fixtureState.sdkMode = event.target.value;
              setSdkMode(event.target.value);
            }}
          >
            <option value="ready">합성 인증 수단 있음</option>
            <option value="throw">예외</option>
            <option value="stall">응답 없음</option>
            <option value="json-stall">본문 응답 없음</option>
          </select>
        </label>
        <label>
          로컬 요청 응답
          <select
            value={networkMode}
            onChange={(event) => {
              fixtureState.networkMode = event.target.value;
              setNetworkMode(event.target.value);
            }}
          >
            <option value="throw">연결 예외</option>
            <option value="success">합성 확인 응답</option>
            <option value="malformed">잘못된 응답</option>
            <option value="wrong-family">다른 작업 종류의 응답</option>
            <option value="stall">응답 없음</option>
          </select>
        </label>
      </div>
      {kind === "admin-mfa" ? (
        <MfaGate key={sdkMode} returnTo="/fixture-only-return" />
      ) : null}
      {kind === "admin-step-up" ? (
        <>
          <div className="fixture-host-controls">
            <label>
              합성 작업 종류
              <select
                value={commandFamily}
                onChange={(event) => setCommandFamily(event.target.value)}
              >
                <option value="KYC_REVIEW">신원 검토</option>
                <option value="WITHDRAWAL_OPERATOR">출금 운영</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={parentPending}
                onChange={(event) => setParentPending(event.target.checked)}
              />{" "}
              합성 부모 작업 진행 중
            </label>
          </div>
          <StepUpTokenField
            commandFamily={commandFamily}
            submissionPending={parentPending}
          />
        </>
      ) : null}
      {kind === "admin-kyc" ? (
        <>
          <label className="fixture-host-control">
            <input
              type="checkbox"
              checked={evidenceAvailable}
              onChange={(event) => setEvidenceAvailable(event.target.checked)}
            />{" "}
            합성 제출 자료 확인 가능
          </label>
          <KycReviewForm
            caseId="fixture-only-kyc-case"
            evidenceAvailable={evidenceAvailable}
          />
        </>
      ) : null}
      {kind === "admin-today" ? (
        <>
          <label className="fixture-host-control">
            합성 대기열 상태
            <select
              value={todayState}
              onChange={(event) => setTodayState(event.target.value)}
            >
              <option value="populated">자료 있음</option>
              <option value="partial">일부 조회 실패</option>
              <option value="empty">실제 0건</option>
            </select>
          </label>
          <TodayView snapshot={todaySnapshot(todayState)} />
        </>
      ) : null}
      <section className="fixture-style-probes" aria-label="운영자 스타일 표본">
        <p>실제 운영자 CSS 클래스의 합성 표본 · 운영 상태가 아닙니다.</p>
        <button className="gold-button" type="button">
          골드 버튼 표본
        </button>
        <button className="danger-button" type="button">
          위험 버튼 표본
        </button>
        <p className="form-error">오류 색상 표본</p>
        <p className="warn-note">주의 색상 표본</p>
      </section>
    </main>
  );
}
