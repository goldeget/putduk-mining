"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useSyncExternalStore } from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { readPluginKey } from "@/lib/support/channel-session";
import { createSupportController } from "@/lib/support/support-controller";
import { readThemePreference, subscribeTheme } from "@/lib/design/theme";
import {
  useSupportDisplayState,
  type SupportDisplayState,
} from "./use-support-display-state";

import styles from "./support-runtime.module.css";

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

function supportStatusCopy(state: SupportDisplayState) {
  if (state === "ready") {
    return "상담 창을 열 준비가 되었어요.";
  }
  if (state === "loading") {
    return "상담 창을 준비하고 있어요.";
  }
  return pluginKey
    ? "상담 창 준비가 지연되고 있어요. 아래 안내를 먼저 확인해 주세요."
    : "지금은 아래 안내를 먼저 확인해 주세요.";
}

export function SupportRuntime({
  memberLauncher = true,
}: {
  memberLauncher?: boolean;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const appearance = useSyncExternalStore(
    subscribeTheme,
    readThemePreference,
    () => "system" as const,
  );
  const booted = useSyncExternalStore(
    controller.subscribe,
    controller.isBooted,
    () => false,
  );
  const uiState = useSupportDisplayState(booted, Boolean(pluginKey));

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

  const aboveNavigation =
    [
      "/events",
      "/home",
      "/menu",
      "/mining",
      "/notifications",
      "/products",
      "/start",
      "/wallet",
    ].some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    pathname === "/ai";

  if (aboveNavigation && !memberLauncher) return null;

  return (
    <div
      className={["support-dock", aboveNavigation ? "support-dock--member" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        id="putduk-support-launcher"
        className={[
          "button",
          "button--primary",
          "support-launcher",
          "putduk-support-launcher",
          aboveNavigation ? "support-launcher--raised" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        type="button"
        aria-label={uiState === "unavailable" ? "상담 안내 열기" : "상담 열기"}
        data-support-state={uiState}
        onClick={() => {
          if (booted) {
            return;
          }
          router.push("/support");
        }}
      >
        <PutdukIcon name="spark" size={18} />
        <span>{uiState === "unavailable" ? "상담 안내" : "상담"}</span>
      </button>
    </div>
  );
}

export function SupportStartButton() {
  const statusId = useId();
  const booted = useSyncExternalStore(
    controller.subscribe,
    controller.isBooted,
    () => false,
  );
  const uiState = useSupportDisplayState(booted, Boolean(pluginKey));
  const statusCopy = supportStatusCopy(uiState);

  return (
    <div className={styles.startWrap}>
      <button
        id="putduk-support-launcher"
        className="button button--primary putduk-support-launcher"
        type="button"
        data-support-state={uiState}
        aria-describedby={statusId}
        onClick={() => {
          if (booted) {
            return;
          }
          document.getElementById("support-guide")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
            block: "start",
          });
        }}
      >
        {uiState === "loading"
          ? "준비 중"
          : uiState === "ready"
            ? "상담 시작"
            : "안내 보기"}
      </button>
      <p
        id={statusId}
        className={styles.status}
        data-support-state={uiState}
        role="status"
        aria-live="polite"
      >
        {statusCopy}
      </p>
    </div>
  );
}
