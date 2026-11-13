"use client";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";

export const inboxChanged = "workroom-inbox-changed";
export class AppRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function appEndpoint(admin: boolean) {
  return admin ? "/api/v1/admin/workroom-app" : "/api/v1/workroom-app";
}
export async function appRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  const value = (await response.json()) as {
    data?: unknown;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new AppRequestError(
      response.status === 401 || response.status === 403
        ? "로그인과 이용 권한을 다시 확인해 주세요."
        : (value.error?.message ?? "불러오지 못했어요. 다시 시도해 주세요."),
      response.status,
    );
  const parsed = schema.safeParse(value.data);
  if (!parsed.success)
    throw new AppRequestError(
      "서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      502,
    );
  return parsed.data;
}
export function appCommand<T>(
  admin: boolean,
  operation: string,
  input: Record<string, unknown>,
  key: string,
  schema: z.ZodType<T>,
) {
  return appRequest(appEndpoint(admin), schema, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ operation, input }),
  });
}
export function useVisibleResource<T>(
  url: string | null,
  schema: z.ZodType<T>,
  merge?: (previous: T, next: T) => T,
) {
  const [resource, setResource] = useState<{ url: string; data: T } | null>(
    null,
  );
  const [authorizationLost, setAuthorizationLost] = useState(false);
  const [failure, setFailure] = useState<{
    url: string;
    message: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let running = false;
    let controller: AbortController | null = null;
    if (!url) return;
    const load = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      controller = new AbortController();
      try {
        const next = await appRequest(url, schema, {
          signal: controller.signal,
        });
        if (active) {
          setResource((previous) => ({
            url,
            data:
              previous?.url === url && merge
                ? merge(previous.data, next)
                : next,
          }));
          setFailure(null);
          setAuthorizationLost(false);
        }
      } catch (cause) {
        if (
          active &&
          !(cause instanceof Error && cause.name === "AbortError")
        ) {
          setFailure({
            url,
            message:
              cause instanceof Error ? cause.message : "연결을 확인해 주세요.",
          });
          if (
            cause instanceof AppRequestError &&
            [401, 403].includes(cause.status)
          ) {
            setAuthorizationLost(true);
            setResource(null);
          }
        }
      } finally {
        running = false;
      }
    };
    void load();
    const visibility = () => {
      if (document.visibilityState === "hidden") controller?.abort();
      else void load();
    };
    const timer = window.setInterval(() => void load(), 15000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", load);
    window.addEventListener(inboxChanged, load);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", load);
      window.removeEventListener(inboxChanged, load);
    };
  }, [url, schema, revision, merge]);
  return {
    data: resource?.url === url ? resource.data : null,
    error: failure?.url === url ? failure.message : "",
    loading: Boolean(url) && resource?.url !== url && failure?.url !== url,
    refresh,
    authorizationLost,
  };
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
