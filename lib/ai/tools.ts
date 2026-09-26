export type AiToolDefinition = {
  description: string;
  name: string;
  readOnly: true;
};

// V1 intentionally exposes no provider-callable tools. Public facts are added to
// the prompt as immutable context, and asset/admin commands remain unreachable.
export const AI_TOOL_REGISTRY: readonly AiToolDefinition[] = [];

export function assertAiToolBoundary() {
  if (AI_TOOL_REGISTRY.some((tool) => tool.readOnly !== true)) {
    throw new Error("AI_MUTATION_TOOL_FORBIDDEN");
  }
}
