// 로컬 Docker Auth는 콜드 스타트에서 5초를 넘길 수 있어 테스트/개발은 여유를 둔다.
export const SUPABASE_SERVER_FETCH_TIMEOUT_MS =
  process.env.APP_ENV === "test" || process.env.NODE_ENV === "development"
    ? 15_000
    : 5_000;

/** APP_ENV=test 전용. 브라우저 page.route로는 SSR Supabase 조회를 가로채지 못한다. */
export const E2E_FORCE_REST_FAILURE_COOKIE = "putduk-e2e-force-rest-failure";

type ServerFetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** `/rest/v1/{table}` 읽기만 실패시킨다. auth 경로는 건드리지 않는다. */
  forceRestFailures?: readonly string[];
};

/**
 * 고장 쿠키는 APP_ENV=test 에서만 읽는다.
 * production 을 포함한 그 외 환경에서는 쿠키가 있어도 효과가 없다.
 */
export function resolveE2eForceRestFailureTables(
  appEnv: string | undefined,
  cookieValue: string | undefined | null,
): string[] {
  if (appEnv !== "test") {
    return [];
  }
  return parseE2eForceRestFailureTables(cookieValue);
}

/** 쿠키 값에서 안전한 스냅샷 테이블 이름만 허용한다. */
export function parseE2eForceRestFailureTables(
  raw: string | undefined | null,
): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^[a-z][a-z0-9_]*$/i.test(part));
}

function matchesForcedRestTable(url: string, table: string): boolean {
  return new RegExp(`/rest/v1/${table}(?:\\?|/|$)`).test(url);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

export function createSupabaseServerFetch({
  fetchImpl = globalThis.fetch,
  timeoutMs = SUPABASE_SERVER_FETCH_TIMEOUT_MS,
  forceRestFailures = [],
}: ServerFetchOptions = {}): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Supabase server fetch timeout must be positive.");
  }

  const failTables = [...forceRestFailures];

  return async (input, init) => {
    if (failTables.length > 0) {
      const url = requestUrl(input);
      for (const table of failTables) {
        if (matchesForcedRestTable(url, table)) {
          return new Response(
            JSON.stringify({
              message: "forced-read-failure",
              code: "E2E_FORCE_REST_FAILURE",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }
    }

    const controller = new AbortController();
    const requestSignal = init?.signal;
    const abortFromRequest = () => controller.abort(requestSignal?.reason);

    if (requestSignal?.aborted) {
      abortFromRequest();
    } else {
      requestSignal?.addEventListener("abort", abortFromRequest, {
        once: true,
      });
    }

    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abortFromRequest);
    }
  };
}

export const supabaseServerFetch = createSupabaseServerFetch();
