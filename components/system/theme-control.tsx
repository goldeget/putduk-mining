"use client";

import { useEffect, useSyncExternalStore } from "react";

type ThemePreference = "system" | "light" | "dark";

const storageKey = "putduk-theme";
const changeEvent = "putduk-theme-change";

function readPreference(): ThemePreference {
  const saved = window.localStorage.getItem(storageKey);
  return saved === "light" || saved === "dark" || saved === "system"
    ? saved
    : "system";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(changeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(changeEvent, onStoreChange);
  };
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = preference;
  }
  root.style.colorScheme = preference === "system" ? "light dark" : preference;
}

export function ThemeControl() {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    (): ThemePreference => "system",
  );

  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  return (
    <label className="theme-control">
      <span>화면 테마</span>
      <select
        aria-label="화면 테마"
        value={preference}
        onChange={(event) => {
          const next = event.target.value as ThemePreference;
          window.localStorage.setItem(storageKey, next);
          applyPreference(next);
          window.dispatchEvent(new Event(changeEvent));
        }}
      >
        <option value="system">시스템</option>
        <option value="light">라이트</option>
        <option value="dark">다크</option>
      </select>
    </label>
  );
}
