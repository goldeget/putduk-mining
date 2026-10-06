"use client";

import { useSyncExternalStore } from "react";

import { subscribeTheme, type ResolvedTheme } from "./theme";

function readResolvedTheme(): ResolvedTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Uses the existing pre-paint bootstrap and explicit/system theme events. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, readResolvedTheme, () => "dark");
}
