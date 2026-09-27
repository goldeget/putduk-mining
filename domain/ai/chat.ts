import { z } from "zod";

export const AI_QUESTION_MAX_CHARACTERS = 2_000;

export const AI_SAFE_ROUTES = [
  "/",
  "/ai",
  "/events",
  "/home",
  "/login",
  "/menu",
  "/menu/ai",
  "/menu/notifications",
  "/mining",
  "/notifications",
  "/offline",
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
    question: z.string().trim().min(3).max(AI_QUESTION_MAX_CHARACTERS),
    screenContext: aiScreenContextSchema.optional(),
  })
  .strict();

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export type AiClientStreamEvent =
  | {
      requestId: string;
      source: "cache" | "provider" | "static" | "tool";
      type: "ready";
    }
  | {
      text: string;
      type: "delta";
    }
  | {
      knowledgeVersion: string;
      grounding?: {
        asOf: string;
        source: "domain_tool";
        tool: string;
      };
      requestId: string;
      type: "done";
    }
  | {
      code: string;
      message: string;
      type: "error";
    };
