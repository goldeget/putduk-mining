import "server-only";

import { z } from "zod";

import { getPublicEnv } from "./public";
import {
  MEMBER_AI_MAX_REQUESTS_PER_DAY,
  MEMBER_AI_MAX_REQUESTS_PER_MINUTE,
} from "../ai/member-policy";

const optionalServerString = <T extends z.ZodType<string>>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const boundedInteger = (minimum: number, maximum: number, fallback: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? fallback : value),
    z.coerce.number().int().min(minimum).max(maximum),
  );

const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]),
    APP_TIMEZONE: z.literal("UTC"),
    SUPABASE_SECRET_KEY: z.string().min(20),
    WITHDRAWAL_DATA_KEY: optionalServerString(
      z
        .string()
        .refine((value) => Buffer.from(value, "base64").byteLength === 32, {
          message: "WITHDRAWAL_DATA_KEY must decode to exactly 32 bytes.",
        }),
    ),
    VAPID_PRIVATE_KEY: optionalServerString(z.string().min(20)),
    VAPID_SUBJECT: optionalServerString(z.string().startsWith("mailto:")),
    AI_PROVIDER: optionalServerString(z.enum(["openai", "nvidia"])),
    AI_API_KEY: optionalServerString(z.string().min(20)),
    NVIDIA_API_KEY: optionalServerString(z.string().min(20)),
    OPENROUTER_FREE_API_KEY: optionalServerString(z.string().min(20)),
    OPENROUTER_API_KEY: optionalServerString(z.string().min(20)),
    AI_FIRST_TOKEN_TIMEOUT_MS: boundedInteger(1000, 90000, 2000),
    AI_MODEL_LOW_COST: optionalServerString(
      z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/),
    ),
    AI_MODEL_HIGH_CAPABILITY: optionalServerString(
      z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/),
    ),
    AI_MAX_OUTPUT_TOKENS: boundedInteger(128, 4096, 900),
    AI_MAX_REQUESTS_PER_MINUTE: boundedInteger(
      1,
      MEMBER_AI_MAX_REQUESTS_PER_MINUTE,
      MEMBER_AI_MAX_REQUESTS_PER_MINUTE,
    ),
    AI_MAX_REQUESTS_PER_DAY: boundedInteger(
      1,
      MEMBER_AI_MAX_REQUESTS_PER_DAY,
      MEMBER_AI_MAX_REQUESTS_PER_DAY,
    ),
    AI_CACHE_TTL_SECONDS: boundedInteger(60, 86400, 3600),
  })
  .superRefine((value, context) => {
    if (
      value.AI_API_KEY &&
      value.NVIDIA_API_KEY &&
      value.AI_API_KEY !== value.NVIDIA_API_KEY
    )
      context.addIssue({
        code: "custom",
        path: ["NVIDIA_API_KEY"],
        message: "NVIDIA key aliases conflict.",
      });
    if (
      value.AI_PROVIDER === "nvidia" &&
      value.AI_MODEL_LOW_COST !== "openai/gpt-oss-20b"
    )
      context.addIssue({
        code: "custom",
        path: ["AI_MODEL_LOW_COST"],
        message: "The owner-approved NVIDIA chain must start at GPT OSS 20B.",
      });
    const aiValues = [
      value.AI_PROVIDER,
      value.AI_API_KEY,
      value.AI_MODEL_LOW_COST,
    ];
    const configuredAiValues = aiValues.filter(Boolean).length;
    if (configuredAiValues > 0 && configuredAiValues < aiValues.length) {
      for (const key of [
        "AI_PROVIDER",
        "AI_API_KEY",
        "AI_MODEL_LOW_COST",
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message:
              "AI_PROVIDER, AI_API_KEY and AI_MODEL_LOW_COST must be configured together.",
          });
        }
      }
    }

    if (
      value.AI_MODEL_HIGH_CAPABILITY &&
      configuredAiValues !== aiValues.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["AI_MODEL_HIGH_CAPABILITY"],
        message:
          "AI_MODEL_HIGH_CAPABILITY requires the complete base AI provider configuration.",
      });
    }

    const hasAnyVapidValue = Boolean(
      value.VAPID_PRIVATE_KEY || value.VAPID_SUBJECT,
    );
    if (
      hasAnyVapidValue &&
      (!value.VAPID_PRIVATE_KEY || !value.VAPID_SUBJECT)
    ) {
      context.addIssue({
        code: "custom",
        path: ["VAPID_PRIVATE_KEY"],
        message:
          "VAPID_PRIVATE_KEY and VAPID_SUBJECT must be configured together.",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema> &
  ReturnType<typeof getPublicEnv>;

/** Configuration presence only; neither provider health nor authorization. */
export function hasConfiguredAiProvider(): boolean {
  const provider = serverEnvSchema.shape.AI_PROVIDER.safeParse(
    process.env.AI_PROVIDER,
  );
  const key = serverEnvSchema.shape.AI_API_KEY.safeParse(
    process.env.AI_API_KEY || process.env.NVIDIA_API_KEY,
  );
  const model = serverEnvSchema.shape.AI_MODEL_LOW_COST.safeParse(
    process.env.AI_MODEL_LOW_COST,
  );
  return Boolean(
    provider.success &&
    key.success &&
    model.success &&
    provider.data === "nvidia" &&
    key.data &&
    model.data === "openai/gpt-oss-20b" &&
    (!process.env.AI_API_KEY ||
      !process.env.NVIDIA_API_KEY ||
      process.env.AI_API_KEY === process.env.NVIDIA_API_KEY) &&
    process.env.APP_ENV !== "production",
  );
}

export function getServerEnv(): ServerEnv {
  const server = serverEnvSchema.parse({
    APP_ENV: process.env.APP_ENV,
    APP_TIMEZONE: process.env.APP_TIMEZONE,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    WITHDRAWAL_DATA_KEY: process.env.WITHDRAWAL_DATA_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY || process.env.NVIDIA_API_KEY,
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
    OPENROUTER_FREE_API_KEY: process.env.OPENROUTER_FREE_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    AI_FIRST_TOKEN_TIMEOUT_MS: process.env.AI_FIRST_TOKEN_TIMEOUT_MS,
    AI_MODEL_LOW_COST: process.env.AI_MODEL_LOW_COST,
    AI_MODEL_HIGH_CAPABILITY: process.env.AI_MODEL_HIGH_CAPABILITY,
    AI_MAX_OUTPUT_TOKENS: process.env.AI_MAX_OUTPUT_TOKENS,
    AI_MAX_REQUESTS_PER_MINUTE: process.env.AI_MAX_REQUESTS_PER_MINUTE,
    AI_MAX_REQUESTS_PER_DAY: process.env.AI_MAX_REQUESTS_PER_DAY,
    AI_CACHE_TTL_SECONDS: process.env.AI_CACHE_TTL_SECONDS,
  });

  return { ...getPublicEnv(), ...server };
}
