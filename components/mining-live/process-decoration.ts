import { processPathPoint } from "@/lib/mining-scene/process-profile";
import type { ScenePoint, SceneProcessProfile } from "@/lib/mining-scene/types";

type Project = (point: ScenePoint) => ScenePoint;
/** One bounded decorative clock; it never reads balances, rates, sessions or product codes. */
export function drawProcessDecoration(
  paint: CanvasRenderingContext2D,
  profile: SceneProcessProfile,
  seconds: number,
  particleCount: number,
  project: Project,
  origin: ScenePoint,
  radius: number,
): void {
  const phase = (seconds / profile.cycleSeconds) % 1;
  const count = Math.min(8, Math.max(0, Math.floor(particleCount)));
  paint.shadowBlur = 5;
  paint.shadowColor = profile.palette[0];
  paint.lineWidth = 1;
  for (const path of profile.paths) {
    const from = project(path.from),
      control = project(path.control),
      to = project(path.to);
    paint.globalAlpha = 0.12;
    paint.strokeStyle = profile.palette[0];
    paint.beginPath();
    paint.moveTo(from.x, from.y);
    paint.quadraticCurveTo(control.x, control.y, to.x, to.y);
    paint.stroke();
  }
  for (let index = 0; index < count; index += 1) {
    const path = profile.paths[index % profile.paths.length]!;
    const t = (phase + index / Math.max(1, count)) % 1;
    const point = project(processPathPoint(path, t));
    paint.globalAlpha = 0.18 + Math.sin(t * Math.PI) * 0.3;
    paint.fillStyle = profile.palette[index % 2]!;
    paint.strokeStyle = profile.palette[index % 2]!;
    paint.beginPath();
    switch (profile.mode) {
      case "raster-scan":
        paint.moveTo(point.x - radius * 0.7, point.y);
        paint.lineTo(point.x + radius * 0.7, point.y);
        paint.stroke();
        break;
      case "vertical-assembly":
        paint.rect(point.x - 4, point.y - 1, 8, 2);
        paint.fill();
        break;
      case "layered-routing":
        paint.rect(point.x - 2, point.y - 2, 4, 4);
        paint.stroke();
        break;
      case "gravity-flow":
        paint.ellipse(point.x, point.y, 1.3, 3, 0, 0, Math.PI * 2);
        paint.fill();
        break;
      case "electrode-rise":
        paint.moveTo(point.x - 3, point.y + 3);
        paint.lineTo(point.x, point.y);
        paint.lineTo(point.x + 3, point.y + 3);
        paint.stroke();
        break;
      case "block-lattice":
        paint.rect(point.x - 3, point.y - 3, 6, 6);
        paint.stroke();
        break;
      case "orbital-consensus":
        paint.arc(point.x, point.y, 2, 0, Math.PI * 2);
        paint.stroke();
        break;
      case "hex-routing":
        for (let side = 0; side <= 6; side += 1) {
          const angle = (side * Math.PI) / 3;
          const x = point.x + Math.cos(angle) * 3,
            y = point.y + Math.sin(angle) * 3;
          if (side === 0) paint.moveTo(x, y);
          else paint.lineTo(x, y);
        }
        paint.stroke();
        break;
      case "gateway-stream":
        paint.moveTo(point.x - 4, point.y);
        paint.quadraticCurveTo(point.x, point.y - 4, point.x + 4, point.y);
        paint.stroke();
        break;
    }
  }
  if (
    profile.mode === "orbital-consensus" ||
    profile.mode === "hex-routing" ||
    profile.mode === "gateway-stream"
  ) {
    paint.globalAlpha = 0.13;
    paint.strokeStyle = profile.palette[1];
    paint.beginPath();
    paint.ellipse(
      origin.x,
      origin.y,
      radius,
      radius * (profile.mode === "orbital-consensus" ? 0.5 : 0.3),
      0,
      phase * Math.PI * 2,
      phase * Math.PI * 2 + Math.PI * 1.1,
    );
    paint.stroke();
  }
  paint.globalAlpha = 1;
  paint.shadowBlur = 0;
  paint.setTransform(1, 0, 0, 1, 0, 0);
}
