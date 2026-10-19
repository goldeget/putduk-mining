/**
 * 안전 모드(safe_mode_controls) 판정. 순수 함수만 둔다. 앱과 worker가 함께 쓴다.
 *
 * DB의 app_private.assert_not_safe_mode(text[])와 같은 조건이다.
 *   control.component = any(p_components)
 *   and control.is_paused
 *   and control.starts_at <= statement_timestamp()
 *
 * app_private 스키마는 PostgREST에 공개되지 않아 앱에서 함수를 직접 호출할 수 없다.
 * 그래서 서버 코드가 같은 표를 같은 조건으로 읽는다. 브라우저는 판정하지 않는다.
 * 읽기 오류나 모양이 맞지 않는 값은 "허용"이 아니라 UNKNOWN으로 취급한다.
 */

/** 앱 코드가 직접 막는 구성 요소. 나머지는 DB 명령이 이미 막는다. */
export const APP_GUARDED_SAFE_MODE_COMPONENTS = Object.freeze([
  "SIGNUP",
  "AI",
  "NOTIFICATION",
]);

/** GLOBAL은 모든 구성 요소를 함께 멈춘다. */
export function safeModeComponentsFor(component) {
  return ["GLOBAL", component];
}

/**
 * rows는 component in (GLOBAL, 대상)으로 이미 좁혀 읽은 값이어야 한다.
 * 하나라도 읽을 수 없으면 UNKNOWN이다. 멈춘 것이 하나라도 있으면 PAUSED이다.
 */
export function decideSafeMode(rows, component, now) {
  if (!Array.isArray(rows)) return "UNKNOWN";
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) return "UNKNOWN";
  const watched = new Set(safeModeComponentsFor(component));

  let unknown = false;
  for (const row of rows) {
    if (!row || typeof row.component !== "string") {
      unknown = true;
      continue;
    }
    if (!watched.has(row.component)) continue;
    if (typeof row.is_paused !== "boolean") {
      unknown = true;
      continue;
    }
    if (!row.is_paused) continue;
    if (typeof row.starts_at !== "string") {
      unknown = true;
      continue;
    }
    const startMs = Date.parse(row.starts_at);
    if (!Number.isFinite(startMs)) {
      unknown = true;
      continue;
    }
    if (startMs <= nowMs) return "PAUSED";
  }
  return unknown ? "UNKNOWN" : "ACTIVE";
}

/**
 * client는 supabase-js 호환 service 클라이언트다. 읽기에 실패하면 UNKNOWN이다.
 * 가입·AI·알림 서버 경로와 worker가 같은 읽기를 쓴다.
 */
export async function readSafeModeDecision(
  client,
  component,
  now = new Date(),
) {
  try {
    if (!client || typeof client.from !== "function") return "UNKNOWN";
    const { data, error } = await client
      .from("safe_mode_controls")
      .select("component,is_paused,starts_at")
      .in("component", safeModeComponentsFor(component));
    if (error) return "UNKNOWN";
    return decideSafeMode(data, component, now);
  } catch {
    return "UNKNOWN";
  }
}

export const SAFE_MODE_MEMBER_COPY = Object.freeze({
  SIGNUP: Object.freeze({
    paused: "지금은 새 가입을 잠시 쉬고 있어요. 나중에 다시 시도해 주세요.",
    unavailable: "가입 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  }),
  AI: Object.freeze({
    paused: "지금은 AI 안내를 잠시 쉬고 있어요. 나중에 다시 시도해 주세요.",
    unavailable:
      "AI 안내 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  }),
  NOTIFICATION: Object.freeze({
    paused: "지금은 알림 보내기를 잠시 쉬고 있어요.",
    unavailable: "알림 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  }),
});
