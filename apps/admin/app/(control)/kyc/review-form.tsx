"use client";

import { useActionState, useRef } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { reviewKycCaseAction } from "./actions";

const DECISIONS = [
  { value: "IN_REVIEW", label: "검토 중으로 유지" },
  { value: "APPROVED", label: "승인" },
  { value: "ON_HOLD", label: "보류" },
  { value: "REQUIRES_RESUBMISSION", label: "재제출 요청" },
  { value: "REJECTED", label: "반려" },
] as const;

/**
 * 입금·출금 step-up 폼과 같이 형제 DOM 을 고정한다.
 * confirmation 조건부 삽입과 step-up 토큰 필드 remount 를 피하기 위해
 * confirmation 은 ConfirmCheckbox, stepUpToken 은 폼 루트 hidden 으로 둔다.
 */
export function KycReviewForm({ caseId }: { caseId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    reviewKycCaseAction,
    null,
  );
  const stepUpTokenRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={action}
      aria-label="본인 확인 검토"
      className="operator-form"
      noValidate
      onReset={(event) => event.preventDefault()}
    >
      <input name="caseId" type="hidden" value={caseId} />
      {/* 폼 루트에 고정. StepUpTokenField remount 와 분리한다. */}
      <input
        ref={stepUpTokenRef}
        name="stepUpToken"
        type="hidden"
        defaultValue=""
      />
      <label className="operator-field">
        <span>결과</span>
        <select name="decision" required defaultValue="IN_REVIEW">
          {DECISIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ReasonField
        label="결정 사유"
        placeholder="왜 이 결정을 했는지 10자 이상 적어 주세요."
      />
      <ConfirmCheckbox
        label="문서 원문·비밀번호·식별 번호는 이 화면에 표시되지 않습니다."
        name="confirmation"
        value="REVIEW_KYC"
      />
      <StepUpTokenField
        commandFamily={ADMIN_COMMAND_FAMILIES.KYC_REVIEW}
        tokenInputRef={stepUpTokenRef}
      />
      <SubmitButton pendingLabel="저장 중…">검토 결과 저장</SubmitButton>
      <QueueFlash result={result} />
      {result && !result.ok ? (
        <p className="panel-note">
          저장에 실패했습니다. 사유와 작업 확인을 점검한 뒤 다시 시도해 주세요.
        </p>
      ) : null}
    </form>
  );
}
