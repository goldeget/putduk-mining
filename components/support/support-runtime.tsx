"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { readPluginKey } from "@/lib/support/channel-session";
import { createSupportController } from "@/lib/support/support-controller";

const pluginKey = readPluginKey(
  process.env.NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY,
);

const controller = createSupportController({
  fetchSession: async () => {
    const response = await fetch("/api/v1/support/channel-session", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { mode: "anonymous" };
    }
    return response.json() as Promise<unknown>;
  },
});

function subscribeTheme(onStoreChange: () => void) {
  window.addEventListener("putduk-theme-change", onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener("putduk-theme-change", onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function readAppearance(): "light" | "dark" | "system" {
  const saved = window.localStorage.getItem("putduk-theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function SupportRuntime() {
  const pathname = usePathname();
  const router = useRouter();
  const appearance = useSyncExternalStore(
    subscribeTheme,
    readAppearance,
    () => "system" as const,
  );
  const booted = useSyncExternalStore(
    controller.subscribe,
    controller.isBooted,
    () => false,
  );

  useEffect(() => {
    if (!pluginKey) {
      return;
    }
    controller.request({
      appearance,
      pathname,
      pluginKey,
      search: window.location.search,
    });
  }, [appearance, pathname]);

  if (pathname === "/support") {
    return null;
  }

  const aboveNavigation = [
    "/ai",
    "/events",
    "/home",
    "/menu",
    "/mining",
    "/notifications",
    "/start",
    "/wallet",
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return (
    <button
      id="putduk-support-launcher"
      className={`button button--primary support-launcher putduk-support-launcher${aboveNavigation ? " support-launcher--raised" : ""}`}
      type="button"
      aria-label="상담 열기"
      data-support-state={pluginKey && booted ? "ready" : "unavailable"}
      onClick={() => {
        if (booted) {
          return;
        }
        router.push("/support");
      }}
    >
      <PutdukIcon name="spark" size={18} />
      <span>상담</span>
    </button>
  );
}

export function SupportStartButton() {
  const booted = useSyncExternalStore(
    controller.subscribe,
    controller.isBooted,
    () => false,
  );

  return (
    <button
      id="putduk-support-launcher"
      className="button button--primary putduk-support-launcher"
      type="button"
      data-support-state={pluginKey && booted ? "ready" : "unavailable"}
      onClick={() => {
        if (booted) {
          return;
        }
        document.getElementById("support-guide")?.scrollIntoView();
      }}
    >
      상담 시작
    </button>
  );
}
