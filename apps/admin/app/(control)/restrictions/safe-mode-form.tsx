"use client";

import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  bindMoneyFormSubmit,
  MoneyOperationFields,
  MoneyOfflineNote,
  useLogicalOperationKey,
} from "@/components/money-operation-form";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";
import { StepUpTokenField } from "@/components/step-up-token-field";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";

import { setSafeModeAction } from "./actions";
import { COMPONENT_LABEL, type SafeModeComponent } from "./safe-mode-policy";

export function SafeModeForm({
  component,
  currentlyPaused,
  canMutate,
  expectedRequestId,
}: {
  component: SafeModeComponent;
  currentlyPaused: boolean;
  canMutate: boolean;
  expectedRequestId: string | null;
}) {
  const formId = useId();
  const router = useRouter();
  const [reviewRevision, setReviewRevision] = useState(0);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const operationKey = useLogicalOperationKey("safe_mode");
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    setSafeModeAction,
    null,
  );
  const nextPause = currentlyPaused ? "false" : "true";

  if (!canMutate) {
    return (
      <p className="panel-note" role="status">
        이 역할로는 제한을 바꿀 수 없습니다. 조회만 가능합니다.
      </p>
    );
  }

  // pause 키로 폼을 다시 만들면 성공 메시지가 사라지고, 토큰도 날아간다.
  return (
    <form
      action={action}
      aria-label={`${COMPONENT_LABEL[component]} 안전 모드`}
      className="operator-form"
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => bindMoneyFormSubmit(event, setOfflineNote)}
      onChange={(event) => {
        const field = event.target;
        if (
          (field instanceof HTMLInputElement ||
            field instanceof HTMLTextAreaElement) &&
          (field.name === "reason" || field.name === "reviewAt")
        )
          setReviewRevision((value) => value + 1);
      }}
    >
      <input name="component" type="hidden" value={component} />
      <input name="pause" type="hidden" value={nextPause} />
      <input
        name="expectedRequestId"
        type="hidden"
        value={expectedRequestId ?? ""}
      />
      <MoneyOperationFields
        operationKey={`${operationKey}:${expectedRequestId ?? "initial"}:${nextPause}:${reviewRevision}`}
      />
      <ReasonField
        label="확인 사유"
        placeholder="왜 멈추거나 푸는지 짧게 적어 주세요."
      />
      <label className="operator-field">
        <span>검토 시각(한국 시간, 선택)</span>
        <input
          aria-describedby={`${formId}-review-hint`}
          name="reviewAt"
          type="datetime-local"
        />
        <span className="panel-note" id={`${formId}-review-hint`}>
          비워 두면 기한 없이 둡니다. 채울 때는 지금보다 이후 시각만 됩니다.
        </span>
      </label>
      <ConfirmCheckbox
        key={`confirm-${expectedRequestId ?? "initial"}-${nextPause}-${reviewRevision}`}
        label={
          currentlyPaused
            ? "제한을 해제합니다. 결과를 감사 기록에 남깁니다."
            : "이 기능을 잠시 멈춥니다. 결과를 감사 기록에 남깁니다."
        }
        name="confirmation"
        value="SAFE_MODE"
      />
      <StepUpTokenField
        key={`step-up-${expectedRequestId ?? "initial"}-${nextPause}-${reviewRevision}`}
        commandFamily={ADMIN_COMMAND_FAMILIES.SAFE_MODE}
      />
      <SubmitButton
        pendingLabel="저장 중…"
        variant={currentlyPaused ? "gold" : "danger"}
      >
        {currentlyPaused ? "제한 해제" : "안전 모드 적용"}
      </SubmitButton>
      <MoneyOfflineNote message={offlineNote} />
      <QueueFlash result={result} />
      {result && !result.ok ? (
        <div>
          <p className="panel-note">
            현재 상태와 입력을 확인해 주세요. 다시 시도할 때는 인증 앱으로 새로
            확인해 주세요.
          </p>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setReviewRevision((value) => value + 1);
              router.refresh();
            }}
          >
            현재 상태 새로고침
          </button>
        </div>
      ) : null}
    </form>
  );
}
