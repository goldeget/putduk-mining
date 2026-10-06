import { z } from "zod";

export const AI_FEEDBACK_REASON_LABELS = {
  INCORRECT: "틀린 정보",
  HARD_TO_UNDERSTAND: "이해하기 어려움",
  NOT_THE_ANSWER: "원하는 답 없음",
  OUTDATED: "오래된 정보",
  ACCOUNT_MISMATCH: "계정정보가 틀림",
  OTHER: "기타",
} as const;

export const aiMemberFeedbackSchema = z
  .object({
    conversationId: z.uuid(),
    messageId: z.uuid(),
    rating: z.enum(["UP", "DOWN"]),
    reasonCode: z
      .enum([
        "INCORRECT",
        "HARD_TO_UNDERSTAND",
        "NOT_THE_ANSWER",
        "OUTDATED",
        "ACCOUNT_MISMATCH",
        "OTHER",
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const reasonMatches =
      (value.rating === "UP" && value.reasonCode === undefined) ||
      (value.rating === "DOWN" && value.reasonCode !== undefined);
    if (!reasonMatches) {
      context.addIssue({
        code: "custom",
        message: "FEEDBACK_REASON_MISMATCH",
        path: ["reasonCode"],
      });
    }
  });

export type AiMemberFeedback = z.infer<typeof aiMemberFeedbackSchema>;
