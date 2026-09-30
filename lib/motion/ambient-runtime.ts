"use client";

import { useMemo, useSyncExternalStore, type RefObject } from "react";

type ConnectionHint = EventTarget & { saveData?: boolean };
type DeviceHints = Pick<Navigator, "hardwareConcurrency"> & {
  connection?: ConnectionHint;
  deviceMemory?: number;
};

export function hasConstrainedMotionCapability(
  device: DeviceHints,
  reducedData: boolean,
  supportsAnimation: boolean,
) {
  return (
    reducedData ||
    device.connection?.saveData === true ||
    (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2) ||
    (typeof device.deviceMemory === "number" && device.deviceMemory <= 2) ||
    !supportsAnimation
  );
}

type AmbientSnapshot = Readonly<{ available: boolean; visible: boolean }>;
const STILL: AmbientSnapshot = { available: false, visible: false };

export function createAmbientRuntime(readElement: () => HTMLElement | null) {
  let snapshot = STILL;

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => STILL,
    subscribe(onChange: () => void) {
      const element = readElement();
      if (!element || typeof IntersectionObserver === "undefined") {
        return () => undefined;
      }

      let inView = false;
      let pageHidden = false;
      let disposed = false;
      let reducedData: MediaQueryList;
      try {
        reducedData = window.matchMedia("(prefers-reduced-data: reduce)");
      } catch {
        return () => undefined;
      }
      const device = navigator as DeviceHints;

      function update() {
        if (disposed) return;
        const available = !hasConstrainedMotionCapability(
          device,
          reducedData.matches,
          typeof CSS !== "undefined" &&
            typeof CSS.supports === "function" &&
            CSS.supports("animation-name", "none"),
        );
        const visible =
          inView && document.visibilityState === "visible" && !pageHidden;
        if (snapshot.available !== available || snapshot.visible !== visible) {
          snapshot = { available, visible };
          onChange();
        }
      }

      function hidePage() {
        pageHidden = true;
        update();
      }
      function showPage() {
        pageHidden = false;
        update();
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          inView = Boolean(
            entry?.isIntersecting && entry.intersectionRatio >= 0.15,
          );
          update();
        },
        { threshold: [0, 0.15] },
      );
      observer.observe(element);
      document.addEventListener("visibilitychange", update);
      window.addEventListener("pagehide", hidePage);
      window.addEventListener("pageshow", showPage);
      reducedData.addEventListener("change", update);
      device.connection?.addEventListener("change", update);
      update();

      return () => {
        disposed = true;
        observer.disconnect();
        document.removeEventListener("visibilitychange", update);
        window.removeEventListener("pagehide", hidePage);
        window.removeEventListener("pageshow", showPage);
        reducedData.removeEventListener("change", update);
        device.connection?.removeEventListener("change", update);
        snapshot = STILL;
      };
    },
  };
}

export function useAmbientRuntime(element: RefObject<HTMLElement | null>) {
  const runtime = useMemo(
    () => createAmbientRuntime(() => element.current),
    [element],
  );
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getServerSnapshot,
  );
}
