"use client";

import { useActionState } from "react";

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
 * 계좌 출금·USDT 입금 step-up 폼과 동일한 DOM 안정 구조.
 * confirmation 을 체크 여부로 넣었다 빼면 StepUpTokenField 가 remount 될 수 있다.
 */
export function KycReviewForm({ caseId }: { caseId: string }) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    reviewKycCaseAction,
    null,
  );

  return (
    <form
      action={action}
      aria-label="본인 확인 검토"
      className="operator-form"
      onReset={(event) => event.preventDefault()}
    >
      <input name="caseId" type="hidden" value={caseId} />
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
      <StepUpTokenField commandFamily={ADMIN_COMMAND_FAMILIES.KYC_REVIEW} />
      <SubmitButton pendingLabel="저장 중…">검토 결과 저장</SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
