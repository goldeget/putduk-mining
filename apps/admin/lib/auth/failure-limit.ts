import "server-only";

import { randomUUID } from "node:crypto";

import {
  ADMIN_AUTH_FAILURE_WINDOW_MS,
  ADMIN_AUTH_PASSWORD_PROOF_MAX_AGE_MS,
  ADMIN_AUTH_TOTP_PROOF_MAX_AGE_MS,
  decideFailureLimit,
  type FailureLimitDecision,
} from "@/lib/auth/failure-limit-policy";
import { createAdminServiceClient } from "@/lib/supabase/service";
import {
  adminAuthFailureBucket,
  adminAuthSessionProof,
} from "../../../../lib/security/rate-limit-bucket";

const FAILURE_EVENT = "ADMIN_AUTH_FAILURE";
const PROOF_EVENT = "ADMIN_AUTH_SERVER_PROOF";
const FAILURE_SURFACE = "admin_auth_failure";
const PROOF_SURFACE = "admin_auth_server_proof";

export type AuthFailureScope = "PASSWORD" | "TOTP";
export type AuthProofKind = "PASSWORD" | "TOTP";
export type FailureBudget = FailureLimitDecision | "UNAVAILABLE";

type Filter = {
  eq: (column: string, value: string) => Filter;
  contains: (column: string, value: Record<string, string>) => Filter;
  gte: (column: string, value: string) => Filter;
  limit: (count: number) => Promise<{
    data: { id: string }[] | null;
    error: { message: string } | null;
  }>;
  then: PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }>["then"];
};

type EventClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options?: { count?: "exact"; head?: boolean },
    ) => Filter;
    insert: (row: Record<string, unknown>) => Promise<{
      error: { message: string } | null;
    }>;
  };
};

export type FailureLimitStore = {
  countFailures(input: {
    scope: AuthFailureScope;
    bucket: string;
    sinceIso: string;
  }): Promise<number | null>;
  insertFailure(input: {
    scope: AuthFailureScope;
    bucket: string;
  }): Promise<boolean>;
  insertProof(input: {
    kind: AuthProofKind;
    userId: string;
    sessionHash: string;
  }): Promise<boolean>;
  hasProof(input: {
    kind: AuthProofKind;
    userId: string;
    sessionHash: string;
    sinceIso: string;
  }): Promise<boolean | null>;
};

/**
 * 공유 Postgres 행이다. 프로세스 메모리가 아니다.
 * app_private.touch_command_rate_limit 은 Data API에 노출되지 않아
 * 새 RPC 없이 호출할 수 없다. 실패 행은 창이 지나면 집계에서 빠진다.
 * IP는 키로 쓰지 않는다. 비밀번호·토큰·세션 원문은 넣지 않는다.
 */
export function createSecurityEventFailureStore(
  db: EventClient,
): FailureLimitStore {
  return {
    async countFailures(input) {
      const { count, error } = await db
        .from("security_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", FAILURE_EVENT)
        .contains("device_context", {
          surface: FAILURE_SURFACE,
          scope: input.scope,
          bucket: input.bucket,
        })
        .gte("occurred_at", input.sinceIso);
      if (error || typeof count !== "number") return null;
      return count;
    },
    async insertFailure(input) {
      const { error } = await db.from("security_events").insert({
        user_id: null,
        event_type: FAILURE_EVENT,
        trusted_client_ip: null,
        ip_source: "NONE",
        user_agent: null,
        device_context: {
          surface: FAILURE_SURFACE,
          scope: input.scope,
          bucket: input.bucket,
        },
        risk_score: null,
        request_id: randomUUID(),
      });
      return !error;
    },
    async insertProof(input) {
      const { error } = await db.from("security_events").insert({
        user_id: input.userId,
        event_type: PROOF_EVENT,
        trusted_client_ip: null,
        ip_source: "NONE",
        user_agent: null,
        device_context: {
          surface: PROOF_SURFACE,
          kind: input.kind,
          sessionHash: input.sessionHash,
        },
        risk_score: null,
        request_id: randomUUID(),
      });
      return !error;
    },
    async hasProof(input) {
      const { data, error } = await db
        .from("security_events")
        .select("id")
        .eq("event_type", PROOF_EVENT)
        .eq("user_id", input.userId)
        .contains("device_context", {
          surface: PROOF_SURFACE,
          kind: input.kind,
          sessionHash: input.sessionHash,
        })
        .gte("occurred_at", input.sinceIso)
        .limit(1);
      if (error) return null;
      return Array.isArray(data) && data.length > 0;
    },
  };
}

function store(): FailureLimitStore {
  return createSecurityEventFailureStore(
    createAdminServiceClient() as unknown as EventClient,
  );
}

function since(maxAgeMs: number): string {
  return new Date(Date.now() - maxAgeMs).toISOString();
}

export async function readAdminAuthFailureBudget(
  scope: AuthFailureScope,
  subject: string,
  events: FailureLimitStore = store(),
): Promise<FailureBudget> {
  const count = await events.countFailures({
    scope,
    bucket: adminAuthFailureBucket(scope, subject),
    sinceIso: since(ADMIN_AUTH_FAILURE_WINDOW_MS),
  });
  if (count === null) return "UNAVAILABLE";
  return decideFailureLimit(count);
}

export async function recordAdminAuthFailure(
  scope: AuthFailureScope,
  subject: string,
  events: FailureLimitStore = store(),
): Promise<boolean> {
  return events.insertFailure({
    scope,
    bucket: adminAuthFailureBucket(scope, subject),
  });
}

export async function writeAdminAuthServerProof(
  input: { kind: AuthProofKind; userId: string; sessionId: string },
  events: FailureLimitStore = store(),
): Promise<boolean> {
  if (!input.sessionId) return false;
  return events.insertProof({
    kind: input.kind,
    userId: input.userId,
    sessionHash: adminAuthSessionProof(input.sessionId),
  });
}

export async function hasAdminAuthServerProof(
  input: { kind: AuthProofKind; userId: string; sessionId: string },
  events: FailureLimitStore = store(),
): Promise<boolean | null> {
  if (!input.sessionId) return false;
  const maxAge =
    input.kind === "TOTP"
      ? ADMIN_AUTH_TOTP_PROOF_MAX_AGE_MS
      : ADMIN_AUTH_PASSWORD_PROOF_MAX_AGE_MS;
  return events.hasProof({
    kind: input.kind,
    userId: input.userId,
    sessionHash: adminAuthSessionProof(input.sessionId),
    sinceIso: since(maxAge),
  });
}
