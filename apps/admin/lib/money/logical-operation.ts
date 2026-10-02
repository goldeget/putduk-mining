const LOGICAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;

export const CLIENT_ONLINE_HEADER = "x-putduk-client-online";

/** 한 번의 돈 요청에 고정하는 키. 재시도는 이 값을 다시 쓴다. */
export function createLogicalOperationKey(prefix: string): string {
  const id = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}_${id}`;
}

export function parseLogicalOperationKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return LOGICAL_KEY.test(key) ? key : null;
}

/** 클라이언트가 끊김을 명시한 경우만 막는다. 헤더 없음은 권한 검사를 대신하지 않는다. */
export function declaredClientOffline(value: unknown): boolean {
  return value === "0";
}

export function requestDeclaredOffline(request: Request): boolean {
  return request.headers.get(CLIENT_ONLINE_HEADER) === "0";
}
