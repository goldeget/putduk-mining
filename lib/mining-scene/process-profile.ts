import {
  SCENE_PROCESS_MODES,
  type ScenePoint,
  type SceneProcessProfile,
} from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function point(value: unknown): value is ScenePoint {
  return (
    record(value) &&
    keys(value, ["x", "y"]) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x + value.y) &&
    value.x >= 0 &&
    value.x <= 1 &&
    value.y >= 0 &&
    value.y <= 1
  );
}
/** Closed visual configuration: no product identity, economic values or executable behavior. */
export function projectProcessProfile(
  value: unknown,
): SceneProcessProfile | null {
  if (
    !record(value) ||
    !keys(value, ["mode", "palette", "cycleSeconds", "paths"]) ||
    typeof value.mode !== "string" ||
    !(SCENE_PROCESS_MODES as readonly string[]).includes(value.mode) ||
    !Array.isArray(value.palette) ||
    value.palette.length !== 2 ||
    !value.palette.every(
      (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color),
    ) ||
    typeof value.cycleSeconds !== "number" ||
    !Number.isFinite(value.cycleSeconds) ||
    value.cycleSeconds < 1 ||
    value.cycleSeconds > 12 ||
    !Array.isArray(value.paths) ||
    value.paths.length < 1 ||
    value.paths.length > 6
  )
    return null;
  const paths: SceneProcessProfile["paths"][number][] = [];
  for (const path of value.paths) {
    if (
      !record(path) ||
      !keys(path, ["from", "control", "to"]) ||
      !point(path.from) ||
      !point(path.control) ||
      !point(path.to)
    )
      return null;
    paths.push({
      from: { x: path.from.x, y: path.from.y },
      control: { x: path.control.x, y: path.control.y },
      to: { x: path.to.x, y: path.to.y },
    });
  }
  // The mode is narrowed by the closed allowlist above, independently of its source.
  return {
    mode: value.mode as SceneProcessProfile["mode"],
    palette: [value.palette[0], value.palette[1]],
    cycleSeconds: value.cycleSeconds,
    paths,
  };
}

export function processPathPoint(
  path: SceneProcessProfile["paths"][number],
  phase: number,
): ScenePoint {
  const t = Number.isFinite(phase) ? Math.max(0, Math.min(1, phase)) : 0;
  const inverse = 1 - t;
  return {
    x:
      inverse * inverse * path.from.x +
      2 * inverse * t * path.control.x +
      t * t * path.to.x,
    y:
      inverse * inverse * path.from.y +
      2 * inverse * t * path.control.y +
      t * t * path.to.y,
  };
}
