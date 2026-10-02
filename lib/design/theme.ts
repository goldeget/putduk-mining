export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const themeStorageKey = "putduk-theme";
export const themeChangeEvent = "putduk-theme-change";
export const themeColors = { dark: "#070706", light: "#f8f4ea" } as const;

export function normalizeTheme(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const current = document.documentElement.dataset.themePreference;
  if (current !== undefined) return normalizeTheme(current);
  try {
    return normalizeTheme(window.localStorage.getItem(themeStorageKey));
  } catch {
    return normalizeTheme(document.documentElement.dataset.themePreference);
  }
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.removeAttribute("media");
    meta.setAttribute("content", themeColors[resolved]);
  });
  return resolved;
}

export function setThemePreference(preference: ThemePreference) {
  applyTheme(preference);
  try {
    window.localStorage.setItem(themeStorageKey, preference);
  } catch {
    // A blocked store still permits an in-memory preference for this document.
  }
  window.dispatchEvent(new Event(themeChangeEvent));
}

export function subscribeTheme(onChange: () => void) {
  window.addEventListener(themeChangeEvent, onChange);
  return () => window.removeEventListener(themeChangeEvent, onChange);
}

// Runs before the first paint; storage access cannot abort rendering.
export const themeBootstrap = `(()=>{let p="system";try{const s=localStorage.getItem("${themeStorageKey}");if(s==="light"||s==="dark")p=s}catch{}const t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;const r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=t;r.style.colorScheme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(m=>{m.removeAttribute("media");m.content=t==="dark"?"${themeColors.dark}":"${themeColors.light}"})})()`;
