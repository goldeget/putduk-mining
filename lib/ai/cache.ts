import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const cachedResponseSchema = z.object({
  answer: z.string().min(1).max(32_000),
  model: z.string().min(1).max(120),
  scope: z.literal("PUBLIC_KNOWLEDGE"),
});

export type CachedAiResponse = Omit<
  z.infer<typeof cachedResponseSchema>,
  "scope"
>;

export async function readAiCache(
  supabase: SupabaseClient,
  cacheKey: string,
  knowledgeVersion: string,
  scope: "PUBLIC_KNOWLEDGE",
): Promise<CachedAiResponse | null> {
  const { data, error } = await supabase
    .from("ai_cache")
    .select("response_payload")
    .eq("cache_key", cacheKey)
    .eq("knowledge_version", knowledgeVersion)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const parsed = cachedResponseSchema.safeParse(data.response_payload);
  if (!parsed.success || parsed.data.scope !== scope) {
    return null;
  }
  return { answer: parsed.data.answer, model: parsed.data.model };
}

export async function writeAiCache(
  supabase: SupabaseClient,
  {
    answer,
    cacheKey,
    knowledgeVersion,
    model,
    scope,
    ttlSeconds,
  }: {
    answer: string;
    cacheKey: string;
    knowledgeVersion: string;
    model: string;
    scope: "PUBLIC_KNOWLEDGE";
    ttlSeconds: number;
  },
) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1_000).toISOString();
  return supabase.from("ai_cache").upsert({
    cache_key: cacheKey,
    expires_at: expiresAt,
    knowledge_version: knowledgeVersion,
    response_payload: { answer, model, scope },
  });
}
