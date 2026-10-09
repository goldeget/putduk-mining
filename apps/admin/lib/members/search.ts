import { z } from "zod";

import { normalizeSignupPhone } from "../../../../domain/identity/signup-phone";

export const MEMBER_SEARCH_LIMIT = 20;
export const MEMBER_SEARCH_QUERY_LIMIT = MEMBER_SEARCH_LIMIT + 1;

export type MemberSearchQuery =
  | { kind: "UUID"; value: string }
  | { kind: "TEXT" | "PHONE"; value: string; phone: string | null };

export function normalizeMemberSearch(
  value: unknown,
): MemberSearchQuery | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const query = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 40 || /[\p{Cc}*]/u.test(query))
    return null;
  const uuid = z.uuid().safeParse(query);
  if (uuid.success) return { kind: "UUID", value: uuid.data.toLowerCase() };
  const phone = /^\+?[\d\s().-]+$/.test(query)
    ? normalizeSignupPhone(query)
    : null;
  // Numeric text still searches login IDs; recognizing a phone never removes that path.
  return { kind: phone ? "PHONE" : "TEXT", value: query, phone };
}

/** LIKE syntax stays literal; never interpolate a raw query into a PostgREST .or filter. */
export function escapeMemberSearchLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function maskMemberName(value: string): string {
  const name = [...value.trim()];
  if (name.length < 2) return name.length ? `${name[0]}*` : "이름 미설정";
  return name.length === 2
    ? `${name[0]}*`
    : `${name[0]}${"*".repeat(name.length - 2)}${name.at(-1)}`;
}

export function maskMemberLoginId(value: string): string {
  return value.length <= 5
    ? `${value.slice(0, 2)}***`
    : `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
}

export const memberSearchResponseSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.uuid(),
        name: z.string().min(1).max(80),
        loginId: z.string().max(40).nullable(),
        phone: z.string().max(40).nullable(),
      }),
    )
    .max(MEMBER_SEARCH_LIMIT),
  hasMore: z.boolean(),
});
export type MemberSearchResult = z.infer<typeof memberSearchResponseSchema>;
