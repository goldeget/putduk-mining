"use client";

import { useState, type ChangeEvent } from "react";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";

type ReviewedResult = { revision: string; result: CommandActionResult };

/** Bind response copy to the exact proposal that was submitted, including late responses. */
export function useReviewedAction(
  command: (
    previous: CommandActionResult | null,
    data: FormData,
  ) => Promise<CommandActionResult>,
  revision: number | string,
) {
  const currentRevision = String(revision);
  const fieldName = "clientReviewRevision";
  const [state, setState] = useState<ReviewedResult | null>(null);
  const action = async (data: FormData) => {
    const submittedRevision = String(data.get(fieldName) ?? "");
    data.delete(fieldName);
    data.set("__adminAction", command.name);
    try {
      const response = await fetch("/api/v1/admin/commands", {
        method: "POST",
        body: data,
      });
      const result = (await response.json()) as CommandActionResult;
      setState({ revision: submittedRevision, result });
    } catch {
      setState({
        revision: submittedRevision,
        result: {
          ok: false,
          code: "NETWORK_ERROR",
          message: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
        },
      });
    }
  };
  const stale = state !== null && state.revision !== currentRevision;
  return {
    action,
    result: stale ? null : (state?.result ?? null),
    stale,
    revisionField: { type: "hidden", name: fieldName, value: currentRevision },
  };
}

/** Editing the proposed effect discards the old checkbox and one-time token. */
export function useAdminCommandAction(actionName: string) {
  const [result, setResult] = useState<CommandActionResult | null>(null);
  const action = async (data: FormData) => {
    data.set("__adminAction", actionName);
    try {
      const response = await fetch("/api/v1/admin/commands", {
        method: "POST",
        body: data,
      });
      setResult((await response.json()) as CommandActionResult);
    } catch {
      setResult({
        ok: false,
        code: "NETWORK_ERROR",
        message: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
      });
    }
  };
  return { result, action };
}

export function useReviewConfirmation(fields?: readonly string[]) {
  const [revision, setRevision] = useState(0);
  function onChange(event: ChangeEvent<HTMLFormElement>) {
    const field = event.target;
    if (
      !(field instanceof HTMLInputElement) &&
      !(field instanceof HTMLTextAreaElement) &&
      !(field instanceof HTMLSelectElement)
    )
      return;
    if (
      !field.name ||
      field.name === "confirmation" ||
      field.name === "stepUpToken" ||
      (fields && !fields.includes(field.name))
    )
      return;
    setRevision((value) => value + 1);
  }
  return { revision, onChange };
}
