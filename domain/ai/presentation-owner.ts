import { z } from "zod";

export const AI_PRESENTATION_OWNER_HEADER = "X-Putduk-AI-Owner";

/**
 * A stale presentation must not receive the newly signed-in account's data.
 * This optional compatibility hint never authenticates or selects an owner.
 */
export function matchesAiPresentationOwner(
  headers: Pick<Headers, "get">,
  verifiedUserId: string,
): boolean {
  const expectedOwner = headers.get(AI_PRESENTATION_OWNER_HEADER);
  if (expectedOwner === null) return true;
  const parsed = z.uuid().safeParse(expectedOwner);
  return (
    parsed.success && parsed.data.toLowerCase() === verifiedUserId.toLowerCase()
  );
}
