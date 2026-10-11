"use client";

import { useActionState, useState, type ChangeEvent } from "react";

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
  const [state, action] = useActionState<ReviewedResult | null, FormData>(
    async (previous, data) => {
      const submittedRevision = String(data.get(fieldName) ?? "");
      // This field controls display only. Keep it out of the domain command payload.
      data.delete(fieldName);
      return {
        revision: submittedRevision,
        result: await command(previous?.result ?? null, data),
      };
    },
    null,
  );
  const stale = state !== null && state.revision !== currentRevision;
  return {
    action,
    result: stale ? null : (state?.result ?? null),
    stale,
    revisionField: { type: "hidden", name: fieldName, value: currentRevision },
  };
}

/** Editing the proposed effect discards the old checkbox and one-time token. */
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
