import type { SupabaseClient } from "@supabase/supabase-js";

import type { AiRoute } from "./router";
import type { AiToolName } from "./tools";
import { assertMemberAiLimits } from "./member-policy";

export type AiAuditContextScope =
  "ACCOUNT_STATE" | "GENERAL_SAFE" | "PUBLIC_FACTS_ONLY" | "UI_HELP";

export type AiAuditRouteKind =
  | "cache"
  | "general_safe"
  | "high_capability"
  | "low_cost"
  | "static"
  | "tool"
  | "ui_help";

export async function beginAiRequest(
  supabase: SupabaseClient,
  input: {
    clientMessageId: string;
    contextScope: AiAuditContextScope;
    inputRedacted: Record<string, boolean | number | string>;
    knowledgeVersion: string;
    model: string;
    perDayLimit: number;
    perMinuteLimit: number;
    promptHash: string;
    routeKey: string;
    routeKind: AiAuditRouteKind;
    safetyClassification: AiRoute["classification"];
    toolName?: AiToolName;
    userId: string;
  },
) {
  assertMemberAiLimits(input);
  return supabase.rpc("begin_ai_request_v2", {
    p_client_message_id: input.clientMessageId,
    p_context_scope: input.contextScope,
    p_input_redacted: input.inputRedacted,
    p_knowledge_version: input.knowledgeVersion,
    p_model_key: input.model,
    p_per_day_limit: input.perDayLimit,
    p_per_minute_limit: input.perMinuteLimit,
    p_prompt_hash: input.promptHash,
    p_route_key: input.routeKey,
    p_route_kind: input.routeKind,
    p_safety_classification: input.safetyClassification,
    p_tool_name: input.toolName ?? null,
    p_user_id: input.userId,
  });
}

export async function completeAiRequest(
  supabase: SupabaseClient,
  input: {
    cachedInputTokens: number;
    inputTokens: number;
    model: string;
    outputTokens: number;
    providerRequestId: string;
    requestId: string;
    responseCharacterCount: number;
    userId: string;
  },
) {
  return supabase.rpc("complete_ai_request", {
    p_cached_input_tokens: input.cachedInputTokens,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_provider_model: input.model,
    p_provider_request_id: input.providerRequestId,
    p_request_id: input.requestId,
    p_response_character_count: input.responseCharacterCount,
    p_user_id: input.userId,
  });
}

export async function failAiRequest(
  supabase: SupabaseClient,
  input: {
    errorCode: string;
    requestId: string;
    status: "CANCELLED" | "FAILED";
    userId: string;
  },
) {
  return supabase.rpc("fail_ai_request", {
    p_error_code: input.errorCode,
    p_request_id: input.requestId,
    p_status: input.status,
    p_user_id: input.userId,
  });
}
