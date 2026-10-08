import "server-only";

import { redactMemberTranscript } from "@/domain/ai/member-transcript";
import type { OwnAiMessage } from "./member-conversation-read";

export type ProviderHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};
const MAX_HISTORY_PAIRS = 20;
const MAX_HISTORY_BYTES = 48_000;

/** Owned server history only. Account/tool receipts and their question are never
 * sent outside PUTDUK. Consecutive storage fragments are joined before pairing.
 * Earlier assistant text is conversational context, never account authority. */
export function buildOwnedProviderHistory(
  messages: readonly OwnAiMessage[],
): ProviderHistoryMessage[] {
  const groups: {
    role: "MEMBER" | "ASSISTANT";
    content: string;
    safe: boolean;
    endPosition: number;
  }[] = [];
  let position = 0;
  for (const message of messages) {
    if (!Number.isSafeInteger(message.position) || message.position <= position)
      throw new Error("AI_HISTORY_ORDER_INVALID");
    position = message.position;
    const safe =
      message.authorRole === "MEMBER" ||
      message.source === "provider" ||
      message.source === "cache" ||
      message.source === "static";
    const previous = groups.at(-1);
    if (
      previous?.role === message.authorRole &&
      !(message.authorRole === "MEMBER" && message.clientMessageId)
    ) {
      previous.content += `\n${message.bodyText}`;
      // Storage attaches the source receipt to the first assistant fragment.
      // Only a contiguous fragment may inherit that already verified receipt.
      previous.safe &&=
        safe ||
        (message.authorRole === "ASSISTANT" &&
          message.source === undefined &&
          message.toolOutcome === undefined &&
          message.position === previous.endPosition + 1);
      previous.endPosition = message.position;
    } else
      groups.push({
        role: message.authorRole,
        content: message.bodyText,
        safe,
        endPosition: message.position,
      });
  }
  const pairs: ProviderHistoryMessage[][] = [];
  for (let index = 0; index < groups.length - 1; index++) {
    const member = groups[index]!,
      assistant = groups[index + 1]!;
    if (
      member.role !== "MEMBER" ||
      assistant.role !== "ASSISTANT" ||
      !assistant.safe
    )
      continue;
    pairs.push([
      { role: "user", content: redactMemberTranscript(member.content) },
      { role: "assistant", content: redactMemberTranscript(assistant.content) },
    ]);
    index++;
  }
  const selected: ProviderHistoryMessage[][] = [];
  let bytes = 0;
  for (const pair of pairs.slice(-MAX_HISTORY_PAIRS).reverse()) {
    const size = pair.reduce(
      (sum, message) =>
        sum + new TextEncoder().encode(message.content).byteLength,
      0,
    );
    if (bytes + size > MAX_HISTORY_BYTES) break;
    selected.unshift(pair);
    bytes += size;
  }
  return selected.flat();
}
