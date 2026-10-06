import { z } from "zod";

export const AI_QUESTION_MAX_CHARACTERS = 2_000;

export const AI_SAFE_ROUTES = [
  "/",
  "/ai",
  "/events",
  "/home",
  "/login",
  "/menu",
  "/menu/account",
  "/menu/ai",
  "/menu/notifications",
  "/mining",
  "/notifications",
  "/offline",
  "/products",
  "/signup",
  "/start",
  "/wallet",
  "/wallet/deposit",
  "/wallet/withdraw",
] as const;

export const aiScreenContextSchema = z
  .object({
    currentProduct: z.uuid().optional(),
    currentRoute: z.enum(AI_SAFE_ROUTES).optional(),
    currentWorld: z
      .enum(["KOREA", "USA", "GOLD", "SILVER", "CRYPTO"])
      .optional(),
    selectedEvent: z.uuid().optional(),
    selectedTransaction: z.uuid().optional(),
  })
  .strict();

export type AiScreenContext = z.infer<typeof aiScreenContextSchema>;

export const aiChatRequestSchema = z
  .object({
    clientMessageId: z.uuid(),
    conversationId: z.uuid().optional(),
    question: z.string().trim().min(3).max(AI_QUESTION_MAX_CHARACTERS),
    screenContext: aiScreenContextSchema.optional(),
  })
  .strict();

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const aiAnswerSourceSchema = z.enum([
  "cache",
  "provider",
  "static",
  "tool",
]);

export const aiAnswerGroundingSchema = z
  .object({
    asOf: z.iso.datetime({ offset: true }),
    source: z.literal("domain_tool"),
    tool: z.string().min(1).max(100),
  })
  .strict();

/** Only the existing server's public stream envelope is a client receipt. */
export const aiClientStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      requestId: z.uuid(),
      source: aiAnswerSourceSchema,
      type: z.literal("ready"),
    })
    .strict(),
  z.object({ text: z.string().max(32_000), type: z.literal("delta") }).strict(),
  z
    .object({
      assistantMessageId: z.uuid().optional(),
      conversationId: z.uuid().optional(),
      knowledgeVersion: z.string().min(1).max(200),
      grounding: aiAnswerGroundingSchema.optional(),
      requestId: z.uuid(),
      saved: z.boolean().optional(),
      type: z.literal("done"),
    })
    .strict(),
  z
    .object({
      code: z.string().min(1).max(100),
      conversationId: z.uuid().optional(),
      message: z.string().min(1).max(4_000),
      saved: z.boolean().optional(),
      type: z.literal("error"),
    })
    .strict(),
]);

export type AiAnswerSource = z.infer<typeof aiAnswerSourceSchema>;
export type AiAnswerGrounding = z.infer<typeof aiAnswerGroundingSchema>;
export type AiClientStreamEvent = z.infer<typeof aiClientStreamEventSchema>;
