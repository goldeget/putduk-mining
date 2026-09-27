"use client";

import { useActionState } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  ConfirmCheckbox,
  ReasonField,
  SubmitButton,
} from "@/components/operator-fields";
import { QueueFlash } from "@/components/queue-shell";

import { setSafeModeAction } from "./actions";

export function SafeModeForm({
  component,
  currentlyPaused,
}: {
  component: string;
  currentlyPaused: boolean;
}) {
  const [result, action] = useActionState<CommandActionResult | null, FormData>(
    setSafeModeAction,
    null,
  );
  const nextPause = currentlyPaused ? "false" : "true";
  return (
    <form action={action} className="operator-form">
      <input name="component" type="hidden" value={component} />
      <input name="pause" type="hidden" value={nextPause} />
      <ReasonField label="확인 사유" />
      <ConfirmCheckbox
        label={
          currentlyPaused
            ? "제한을 해제합니다. 결과를 감사 기록에 남깁니다."
            : "이 기능을 잠시 멈춥니다. 결과를 감사 기록에 남깁니다."
        }
        name="confirmation"
        value="SAFE_MODE"
      />
      <SubmitButton variant={currentlyPaused ? "gold" : "danger"}>
        {currentlyPaused ? "제한 해제" : "안전 모드 적용"}
      </SubmitButton>
      <QueueFlash result={result} />
    </form>
  );
}
