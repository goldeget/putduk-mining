export type QuestRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function placeCoachMark(
  target: QuestRect,
  coach: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 12;
  const gap = 12;
  const width = Math.min(coach.width, viewport.width - margin * 2);
  const height = Math.min(coach.height, viewport.height - margin * 2);
  const clamp = (value: number, maximum: number) =>
    Math.max(margin, Math.min(value, maximum - margin));
  const left = clamp(target.left, viewport.width - width);
  const top = clamp(target.top, viewport.height - height);

  if (target.top + target.height + gap + height <= viewport.height - margin) {
    return {
      left,
      top: clamp(target.top + target.height + gap, viewport.height - height),
    };
  }
  if (target.top - gap - height >= margin) {
    return {
      left,
      top: clamp(target.top - gap - height, viewport.height - height),
    };
  }
  if (target.left + target.width + gap + width <= viewport.width - margin) {
    return {
      left: clamp(target.left + target.width + gap, viewport.width - width),
      top,
    };
  }
  if (target.left - gap - width >= margin) {
    return {
      left: clamp(target.left - gap - width, viewport.width - width),
      top,
    };
  }

  // A full-width, tall target can fill a phone viewport. Keep the dismissible
  // coach within the viewport, choosing the edge furthest from target center.
  return {
    left,
    top:
      target.top + target.height / 2 < viewport.height / 2
        ? viewport.height - height - margin
        : margin,
  };
}

export function visibleSpotlight(
  target: QuestRect,
  viewport: { width: number; height: number },
) {
  const padding = 6;
  const left = Math.max(4, target.left - padding);
  const top = Math.max(4, target.top - padding);
  const right = Math.min(
    viewport.width - 4,
    target.left + target.width + padding,
  );
  const bottom = Math.min(
    viewport.height - 4,
    target.top + target.height + padding,
  );
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
