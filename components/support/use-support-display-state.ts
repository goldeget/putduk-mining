"use client";

import { useEffect, useState } from "react";

export const supportPreparationLimitMs = 15_000;
export type SupportDisplayState = "loading" | "ready" | "unavailable";

/** Bound the preparation message only; never cancel or restart the SDK. */
export function useSupportDisplayState(
  booted: boolean,
  pluginEnabled: boolean,
): SupportDisplayState {
  const [preparation, setPreparation] = useState({
    booted,
    pluginEnabled,
    expired: false,
  });

  // A confirmed readiness transition creates a fresh display deadline.
  // Adjust this component's state before paint, rather than reset it in an effect.
  if (
    preparation.booted !== booted ||
    preparation.pluginEnabled !== pluginEnabled
  ) {
    setPreparation({ booted, pluginEnabled, expired: false });
  }

  useEffect(() => {
    if (booted || !pluginEnabled) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setPreparation({ booted, pluginEnabled, expired: true });
    }, supportPreparationLimitMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [booted, pluginEnabled]);

  if (!pluginEnabled) return "unavailable";
  if (booted) return "ready";
  return preparation.expired ? "unavailable" : "loading";
}
