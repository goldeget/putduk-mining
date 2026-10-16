import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  escapeMemberSearchLiteral,
  maskMemberLoginId,
  maskMemberName,
  MEMBER_SEARCH_LIMIT,
  MEMBER_SEARCH_QUERY_LIMIT,
  type MemberSearchQuery,
  type MemberSearchResult,
} from "./search";

const identitySchema = z.object({
  user_id: z.uuid(),
  legal_name: z.string().min(2).max(40),
  login_id: z.string().min(1).max(20),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
});
const profileSchema = z.object({
  user_id: z.uuid(),
  display_name: z.string().max(40).nullable(),
});
const IDENTITY_FIELDS = "user_id,legal_name,login_id,phone_e164";

/** Only current identity/profile rows. Deleted accounts cascade out; banned accounts remain findable. */
export async function readMemberSearch(
  db: SupabaseClient,
  input: MemberSearchQuery,
): Promise<MemberSearchResult> {
  const identities = new Map<string, z.infer<typeof identitySchema>>();
  const profiles = new Map<string, z.infer<typeof profileSchema>>();
  let hasMore = false;
  function collectIdentity(result: { data: unknown; error: unknown }) {
    if (result.error) throw new Error("MEMBER_SEARCH_UNAVAILABLE");
    const parsed = z
      .array(identitySchema)
      .max(MEMBER_SEARCH_QUERY_LIMIT)
      .safeParse(result.data);
    if (!parsed.success) throw new Error("MEMBER_SEARCH_UNAVAILABLE");
    hasMore ||= parsed.data.length > MEMBER_SEARCH_LIMIT;
    for (const row of parsed.data) identities.set(row.user_id, row);
  }
  function collectProfiles(result: { data: unknown; error: unknown }) {
    if (result.error) throw new Error("MEMBER_SEARCH_UNAVAILABLE");
    const parsed = z
      .array(profileSchema)
      .max(MEMBER_SEARCH_QUERY_LIMIT)
      .safeParse(result.data);
    if (!parsed.success) throw new Error("MEMBER_SEARCH_UNAVAILABLE");
    hasMore ||= parsed.data.length > MEMBER_SEARCH_LIMIT;
    for (const row of parsed.data) profiles.set(row.user_id, row);
  }
  if (input.kind === "UUID") {
    collectIdentity(
      await db
        .from("user_identity_profiles")
        .select(IDENTITY_FIELDS)
        .eq("user_id", input.value)
        .limit(1),
    );
    if (!identities.size)
      collectProfiles(
        await db
          .from("user_profiles")
          .select("user_id,display_name")
          .eq("user_id", input.value)
          .limit(1),
      );
  } else {
    const literal = escapeMemberSearchLiteral(input.value);
    const results = await Promise.all([
      db
        .from("user_identity_profiles")
        .select(IDENTITY_FIELDS)
        .ilike("legal_name", `%${literal}%`)
        .order("legal_name")
        .order("user_id")
        .limit(MEMBER_SEARCH_QUERY_LIMIT),
      db
        .from("user_identity_profiles")
        .select(IDENTITY_FIELDS)
        .ilike("login_id", `${literal.toLowerCase()}%`)
        .order("login_id")
        .order("user_id")
        .limit(MEMBER_SEARCH_QUERY_LIMIT),
      db
        .from("user_profiles")
        .select("user_id,display_name")
        .ilike("display_name", `%${literal}%`)
        .order("display_name")
        .order("user_id")
        .limit(MEMBER_SEARCH_QUERY_LIMIT),
      ...(input.phone
        ? [
            db
              .from("user_identity_profiles")
              .select(IDENTITY_FIELDS)
              .eq("phone_e164", input.phone)
              .limit(1),
          ]
        : []),
    ]);
    collectIdentity(results[0]!);
    collectIdentity(results[1]!);
    collectProfiles(results[2]!);
    if (results[3]) collectIdentity(results[3]);
    const profileIds = [...profiles.keys()].filter((id) => !identities.has(id));
    if (profileIds.length)
      collectIdentity(
        await db
          .from("user_identity_profiles")
          .select(IDENTITY_FIELDS)
          .in("user_id", profileIds)
          .limit(MEMBER_SEARCH_QUERY_LIMIT),
      );
  }
  const userIds = [...new Set([...identities.keys(), ...profiles.keys()])];
  hasMore ||= userIds.length > MEMBER_SEARCH_LIMIT;
  const members = userIds
    .sort((a, b) => {
      const isExact = (id: string) => {
        const identity = identities.get(id);
        return (
          input.kind !== "UUID" &&
          identity &&
          ((input.phone !== null && identity.phone_e164 === input.phone) ||
            identity.login_id.toLowerCase() === input.value.toLowerCase())
        );
      };
      const exactPriority =
        Number(Boolean(isExact(b))) - Number(Boolean(isExact(a)));
      if (exactPriority) return exactPriority;
      const nameA =
        identities.get(a)?.legal_name ?? profiles.get(a)?.display_name ?? "";
      const nameB =
        identities.get(b)?.legal_name ?? profiles.get(b)?.display_name ?? "";
      return nameA.localeCompare(nameB, "ko") || a.localeCompare(b);
    })
    .slice(0, MEMBER_SEARCH_LIMIT)
    .map((userId) => {
      const identity = identities.get(userId);
      return {
        userId,
        name: maskMemberName(
          identity?.legal_name ?? profiles.get(userId)?.display_name ?? "",
        ),
        loginId: identity ? maskMemberLoginId(identity.login_id) : null,
        phone: identity ? `•••• ${identity.phone_e164.slice(-4)}` : null,
      };
    });
  return { members, hasMore };
}
