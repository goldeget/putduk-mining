"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return true;
  }
}

function subscribeToMotionPreference(onChange: () => void) {
  try {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => undefined;
  }
}

// Prerender a still composition. Hydration can enable decoration after checking
// the current preference; a reduced-motion browser never receives autoplay.
export function useMotionPreference() {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    prefersReducedMotion,
    () => true,
  );
}

export function scrollQuestTarget(target: HTMLElement, reducedMotion: boolean) {
  target.scrollIntoView({
    behavior: reducedMotion ? "instant" : "smooth",
    block: "center",
  });
}

export function stopDecorativeScroll() {
  // Explicit instant overrides a stylesheet's scroll-behavior as well, and
  // cancels an in-flight smooth scroll without changing the current position.
  window.scrollTo({
    left: window.scrollX,
    top: window.scrollY,
    behavior: "instant",
  });
}
