import { z } from "zod";

export const AI_QUESTION_MAX_CHARACTERS = 2_000;

export const aiChatRequestSchema = z.object({
  clientMessageId: z.uuid(),
  question: z.string().trim().min(3).max(AI_QUESTION_MAX_CHARACTERS),
});

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export type AiClientStreamEvent =
  | {
      requestId: string;
      source: "cache" | "provider" | "static";
      type: "ready";
    }
  | {
      text: string;
      type: "delta";
    }
  | {
      knowledgeVersion: string;
      requestId: string;
      type: "done";
    }
  | {
      code: string;
      message: string;
      type: "error";
    };
