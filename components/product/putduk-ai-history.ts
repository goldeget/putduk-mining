import type { OwnAiMessage } from "@/lib/ai/member-conversation-read";
import { aiFailure, type PutdukAiMessage } from "./putduk-ai-protocol";

/** Stored bodies are historical evidence, never a fresh account lookup. */
export function restoreOwnAiMessages(
  conversationId: string,
  rows: readonly OwnAiMessage[],
): PutdukAiMessage[] {
  const result: PutdukAiMessage[] = [];
  let question: string | undefined;
  let previousPosition: number | undefined;
  for (const row of rows) {
    const previous = result.at(-1);
    const role = row.authorRole === "ASSISTANT" ? "assistant" : "user";
    // The writer splits long bodies into adjacent same-role chunks. Evidence
    // belongs to the first chunk; join the rest without fabricating receipts.
    const contiguous =
      previousPosition !== undefined && row.position === previousPosition + 1;
    previousPosition = row.position;
    if (
      previous?.role === role &&
      contiguous &&
      row.clientMessageId === null &&
      !row.source
    ) {
      previous.text += `\n${row.bodyText}`;
      if (role === "user") question = previous.text;
      continue;
    }
    if (role === "user") question = row.bodyText;
    const failed = row.toolOutcome === "FAILED";
    result.push({
      id: row.id,
      role,
      state:
        role === "user"
          ? "complete"
          : failed
            ? "error"
            : row.source
              ? "complete"
              : "unverified",
      text: row.bodyText,
      saved: true,
      historical: true,
      conversationId,
      ...(row.recordedAt ? { recordedAt: row.recordedAt } : {}),
      ...(row.source ? { source: row.source } : {}),
      ...(row.source === "static" && row.helpTopic
        ? { helpTopic: row.helpTopic }
        : {}),
      ...(row.knowledgeVersion
        ? { knowledgeVersion: row.knowledgeVersion }
        : {}),
      ...(role === "assistant" ? { assistantMessageId: row.id } : {}),
      ...(failed
        ? {
            failure: aiFailure("AI_TOOL_UNAVAILABLE"),
            ...(question ? { question } : {}),
          }
        : {}),
      ...(role === "assistant" && !row.source
        ? {
            failure: aiFailure("AI_HISTORY_UNVERIFIED"),
            ...(question ? { question } : {}),
          }
        : {}),
    });
  }
  return result;
}
