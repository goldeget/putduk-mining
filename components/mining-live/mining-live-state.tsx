"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  presentFundedMiningRuntime,
  type MiningPresentation,
} from "@/lib/product/mining-presentation";
import type { MiningLiveSnapshot } from "@/lib/product/mining-live-snapshot";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";

export type MiningLiveReadState =
  "checking" | "fresh" | "stale" | "paused" | "blocked";
type Status = Pick<MiningLiveSnapshot, "status" | "stopReason"> & {
  ownerVerified: boolean;
  readState: MiningLiveReadState;
  reopenRequired: boolean;
};
const PresentationContext = createContext<MiningPresentation | null>(null);
const PublisherContext = createContext<((status: Status) => void) | null>(null);

/** Shares accepted status only. The 10 Hz estimate and financial values stay local. */
export function MiningLiveStateProvider({
  initialPresentation,
  children,
}: {
  initialPresentation: MiningPresentation;
  children: ReactNode;
}) {
  const [presentation, setPresentation] = useState(initialPresentation);
  const publish = useCallback((status: Status) => {
    let next = presentFundedMiningRuntime(status.status, status.stopReason);
    if (
      !status.ownerVerified ||
      status.readState === "blocked" ||
      status.reopenRequired
    ) {
      next = {
        source: "unknown",
        running: false,
        label: "상태 확인 중",
        title: "채굴 상태를 다시 확인해 주세요",
        lead: "현재 로그인과 채굴 기록을 다시 확인해 주세요.",
        tone: "neutral",
        action: "reload",
      };
    } else if (status.readState === "paused" || status.readState === "stale") {
      next = {
        ...next,
        source: "unknown",
        running: false,
        label: "마지막 확인 기록",
        title: "채굴 상태를 다시 확인해 주세요",
        lead:
          status.readState === "paused"
            ? "자동 확인을 잠시 멈췄어요. 마지막으로 확인한 기록이에요."
            : "최신 기록을 확인하지 못했어요. 최신 기록을 다시 확인해 주세요.",
        tone: "neutral",
        action: "reload",
      };
    }
    setPresentation((previous) =>
      Object.keys(next).every(
        (key) =>
          previous[key as keyof MiningPresentation] ===
          next[key as keyof MiningPresentation],
      )
        ? previous
        : next,
    );
  }, []);
  return (
    <PublisherContext.Provider value={publish}>
      <PresentationContext.Provider value={presentation}>
        {children}
      </PresentationContext.Provider>
    </PublisherContext.Provider>
  );
}

export const useMiningLivePresentation = () => useContext(PresentationContext);
export const useMiningLiveStatusPublisher = () => useContext(PublisherContext);

export function MiningLiveStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: ProductStatusTone;
}) {
  const current = useMiningLivePresentation();
  return (
    <ProductStatusPill
      label={current?.label ?? label}
      tone={current?.tone ?? tone}
    />
  );
}

export function MiningLiveCopy({
  field,
  fallback,
}: {
  field: "label" | "title" | "lead" | "speedLabel" | "speedLead";
  fallback: string;
}) {
  const current = useMiningLivePresentation();
  if (!current) return fallback;
  if (field === "speedLabel" || field === "speedLead") {
    if (current.source === "unknown")
      return field === "speedLabel"
        ? "마지막 확인 속도"
        : "현재 채굴 상태를 다시 확인해 주세요.";
    if (current.source !== "funded") return fallback;
    return field === "speedLabel"
      ? current.running
        ? "현재 속도"
        : "설정된 속도"
      : current.running
        ? "채굴 속도에 적용하는 배수예요."
        : "현재 채굴은 멈췄어요.";
  }
  return current[field];
}
