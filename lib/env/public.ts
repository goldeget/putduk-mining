import { z } from "zod";

const optionalPublicString = <T extends z.ZodType<string>>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const channelTalkPluginKey = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(trimmed) ? trimmed : undefined;
}, z.string().optional());

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optionalPublicString(z.string().min(20)),
  NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY: channelTalkPluginKey,
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY:
      process.env.NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY,
  });
}
