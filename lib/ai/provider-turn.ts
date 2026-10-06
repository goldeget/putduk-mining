/** 이번 질문만 보낸다. 이전 대화 원문은 제공자 전송 범위가 정해지기 전에는 붙이지 않는다. */
export function buildMemberProviderRequestBody(input: {
  instructions: string;
  maxOutputTokens: number;
  model: string;
  question: string;
}) {
  return {
    input: [
      {
        content: [{ text: input.question, type: "input_text" as const }],
        role: "user" as const,
      },
    ],
    instructions: input.instructions,
    max_output_tokens: input.maxOutputTokens,
    model: input.model,
    store: false as const,
    stream: true as const,
  };
}
