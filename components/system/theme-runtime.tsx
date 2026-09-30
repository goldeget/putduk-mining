"use client";

import { useEffect } from "react";
import {
  applyTheme,
  normalizeTheme,
  readThemePreference,
  themeChangeEvent,
  themeStorageKey,
} from "../../lib/design/theme";

export function ThemeRuntime() {
  useEffect(() => {
    applyTheme(readThemePreference());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const notify = () => window.dispatchEvent(new Event(themeChangeEvent));
    const onSystemChange = () => {
      applyTheme(readThemePreference());
      notify();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== themeStorageKey && event.key !== null) return;
      applyTheme(normalizeTheme(event.newValue));
      notify();
    };
    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
