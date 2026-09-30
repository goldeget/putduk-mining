"use client";

import { useSyncExternalStore } from "react";
import {
  normalizeTheme,
  readThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from "../../lib/design/theme";

export function ThemeControl() {
  const preference = useSyncExternalStore(
    subscribeTheme,
    readThemePreference,
    (): ThemePreference => "system",
  );

  return (
    <label className="theme-control">
      <span>화면 테마</span>
      <select
        aria-label="화면 테마"
        value={preference}
        onChange={(event) =>
          setThemePreference(normalizeTheme(event.target.value))
        }
      >
        <option value="system">시스템</option>
        <option value="light">라이트</option>
        <option value="dark">다크</option>
      </select>
    </label>
  );
}
