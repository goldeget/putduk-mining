"use client";

import { useRef, useState, useTransition } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import { ConfirmCheckbox, ReasonField } from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { reviewKycCaseFromFields } from "./actions";
import { useKycReviewFeedback } from "./review-feedback";

const DECISIONS = [
  { value: "IN_REVIEW", label: "검토 중으로 유지" },
  { value: "APPROVED", label: "승인" },
  { value: "ON_HOLD", label: "보류" },
  { value: "REQUIRES_RESUBMISSION", label: "재제출 요청" },
  { value: "REJECTED", label: "반려" },
] as const;

/**
 * ConfirmCheckbox 로 confirmation DOM 을 고정한다.
 * step-up 토큰은 제출 이벤트(클라이언트)에서 ref 로 읽어 서버 액션 인자로 넘긴다.
 * useActionState 래퍼가 FormData/ref 를 서버 쪽에서 비우는 경로를 피한다.
 */
export function KycReviewForm({
  caseId,
  evidenceAvailable = true,
}: {
  caseId: string;
  evidenceAvailable?: boolean;
}) {
  const stepUpTokenRef = useRef("");
  const [decision, setDecision] = useState<string>("IN_REVIEW");
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const publishFeedback = useKycReviewFeedback();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceAvailable || pending) return;
    const formData = new FormData(event.currentTarget);
    const fromRef = stepUpTokenRef.current.trim();
    const fromDom = String(formData.get("stepUpToken") ?? "").trim();
    const stepUpToken = fromRef.length >= 16 ? fromRef : fromDom;
    publishFeedback?.(null);
    startTransition(async () => {
      const next = await reviewKycCaseFromFields({
        caseId,
        decision: String(formData.get("decision") ?? decision),
        reason: String(formData.get("reason") ?? ""),
        confirmation: String(formData.get("confirmation") ?? ""),
        stepUpToken,
      });
      if (next.ok) publishFeedback?.(next);
      setResult(next);
    });
  }

  return (
    <form
      aria-label="본인 확인 검토"
      className="operator-form"
      noValidate
      onReset={(event) => event.preventDefault()}
      onSubmit={onSubmit}
    >
      <input name="caseId" type="hidden" value={caseId} />
      {!evidenceAvailable ? (
        <p role="alert" className="panel-note">
          제출 서류를 확인한 뒤 검토 결과를 저장할 수 있습니다.
        </p>
      ) : null}
      <fieldset
        disabled={!evidenceAvailable || pending}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          minWidth: 0,
          display: "grid",
          gap: "1rem",
        }}
      >
        <label className="operator-field">
          <span>결과</span>
          <select
            name="decision"
            required
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
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
          submissionPending={pending}
          onTokenIssued={(token) => {
            stepUpTokenRef.current = token;
          }}
        />
        <button
          className="gold-button"
          disabled={pending || !evidenceAvailable}
          type="submit"
        >
          {pending ? "저장 중…" : "검토 결과 저장"}
        </button>
      </fieldset>
      <QueueFlash result={result?.ok && publishFeedback ? null : result} />
    </form>
  );
}
