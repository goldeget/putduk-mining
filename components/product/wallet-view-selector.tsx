"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";

type WalletView = "principal" | "profit" | "history";
const WalletViewContext = createContext<{
  view: WalletView;
}>({ view: "principal" });
const selectionEvent = "putduk:wallet-view-selection";

function subscribeToView(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(selectionEvent, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(selectionEvent, onChange);
  };
}

function currentView(): WalletView {
  return viewFromQuery(window.location.search);
}

function viewFromQuery(query: string): WalletView {
  const values = new URLSearchParams(query).getAll("view");
  return values.length === 1 &&
    (values[0] === "profit" || values[0] === "history")
    ? values[0]
    : "principal";
}

/** Client selection only; financial content remains server-rendered children. */
export function WalletViewSelector({
  initialView,
  className,
  children,
}: {
  initialView: WalletView;
  className: string | undefined;
  children: ReactNode;
}) {
  // Next URL updates also rerender this subscriber; native history is the store.
  useSearchParams();
  const view = useSyncExternalStore(
    subscribeToView,
    currentView,
    () => initialView,
  );
  return (
    <WalletViewContext.Provider value={{ view }}>
      <div
        className={className}
        data-wallet-presentation="wallet-overview-scene"
        data-wallet-active-view={view}
      >
        {children}
      </div>
    </WalletViewContext.Provider>
  );
}

/** Inactive server-rendered slots have no DOM or accessibility-tree nodes. */
export function WalletViewPanel({
  views,
  children,
}: {
  views: readonly WalletView[];
  children: ReactNode;
}) {
  return views.includes(useContext(WalletViewContext).view) ? children : null;
}

export function WalletViewLink({
  view,
  markCurrent = true,
  children,
}: {
  view: WalletView;
  markCurrent?: boolean;
  children: ReactNode;
}) {
  const selected = useContext(WalletViewContext);
  const href = `/wallet?view=${view}`;
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const link = event.currentTarget;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.hasAttribute("download") ||
      (link.target && link.target !== "_self") ||
      window.location.pathname !== "/wallet"
    )
      return;
    event.preventDefault();
    if (
      `${window.location.pathname}${window.location.search}${window.location.hash}` !==
      href
    ) {
      window.history.pushState(null, "", href);
    }
    window.dispatchEvent(new Event(selectionEvent));
  }
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={markCurrent && selected.view === view ? "page" : undefined}
    >
      {children}
    </a>
  );
}
