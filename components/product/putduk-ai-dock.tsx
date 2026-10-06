"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { PutdukAiChat } from "./putduk-ai-chat";
import { PutdukAiMascot } from "./putduk-ai-mascot";
import {
  buildPutdukAiScreenContext,
  buildPutdukAiWideViewHref,
} from "./putduk-ai-screen-context";
import styles from "./putduk-ai-dock.module.css";

const coreRoutes = [
  "/home",
  "/start",
  "/mining",
  "/products",
  "/wallet",
  "/menu",
  "/events",
  "/notifications",
] as const;
const modalSelector = 'dialog[open], [aria-modal="true"]';
const modalConflictCopy = "다른 확인 창을 닫은 뒤 AI 도움을 열어 주세요.";

function hasOtherVisibleModal(ownDialog: HTMLDialogElement) {
  return Array.from(document.querySelectorAll<HTMLElement>(modalSelector)).some(
    (node) => {
      if (node === ownDialog || ownDialog.contains(node) || node.hidden)
        return false;
      const style = window.getComputedStyle(node);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        node.getClientRects().length > 0
      );
    },
  );
}

function changedModalState(
  records: MutationRecord[],
  ownDialog: HTMLDialogElement,
) {
  const hasExternalModal = (node: Element) =>
    (node !== ownDialog &&
      !ownDialog.contains(node) &&
      node.matches(modalSelector)) ||
    Array.from(node.querySelectorAll(modalSelector)).some(
      (candidate) => candidate !== ownDialog && !ownDialog.contains(candidate),
    );
  return records.some((record) => {
    if (record.target === ownDialog || ownDialog.contains(record.target))
      return false;
    if (record.type === "attributes" && record.target instanceof Element)
      return hasExternalModal(record.target);
    return Array.from(record.addedNodes).some(
      (node) => node instanceof Element && hasExternalModal(node),
    );
  });
}

function lockDocumentScroll() {
  const main = document.getElementById("main-content");
  const scrollContainers = [document.documentElement, document.body];
  if (main) scrollContainers.push(main);
  const saved = scrollContainers.flatMap((node) =>
    ["overflow", "overscroll-behavior"].map((property) => ({
      node,
      property,
      value: node.style.getPropertyValue(property),
      priority: node.style.getPropertyPriority(property),
    })),
  );
  for (const { node, property } of saved)
    node.style.setProperty(
      property,
      property === "overflow" ? "hidden" : "none",
    );
  return () => {
    for (const { node, property, value, priority } of saved) {
      if (value) node.style.setProperty(property, value, priority);
      else node.style.removeProperty(property);
    }
  };
}

/** ProductShell supplies the normal-flow row outside its scrolling main. */
export function PutdukAiDock() {
  const pathname = usePathname();
  const dedicatedAi =
    pathname === "/ai" ||
    pathname.startsWith("/ai/") ||
    pathname === "/menu/ai" ||
    pathname.startsWith("/menu/ai/");
  const coreRoute = coreRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  if (dedicatedAi || !coreRoute) return null;

  // A route owns only the panel lifecycle. The shared conversation provider
  // stays mounted above this keyed presentation when the route changes.
  return <RouteAiDock key={pathname} pathname={pathname} />;
}

function RouteAiDock({ pathname }: { pathname: string }) {
  const dialogId = useId();
  const titleId = useId();
  const statusId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const restoreFocusRef = useRef(true);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [wideViewHref, setWideViewHref] = useState("/ai");

  const closePanel = useCallback((restoreFocus = true, updateState = true) => {
    restoreFocusRef.current = restoreFocus;
    const dialog = dialogRef.current;
    const opener = openerRef.current;
    openerRef.current = null;
    releaseRef.current?.();
    releaseRef.current = null;
    if (dialog?.open) dialog.close();
    if (updateState) setOpen(false);
    if (
      restoreFocus &&
      opener?.isConnected &&
      dialog &&
      !hasOtherVisibleModal(dialog)
    )
      opener.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      closePanel(false, false);
      // React may clear the ref before passive unmount cleanup runs.
      if (dialog?.open) dialog.close();
    };
  }, [closePanel]);

  function openPanel(trigger: HTMLButtonElement) {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (hasOtherVisibleModal(dialog)) {
      setStatus(modalConflictCopy);
      return;
    }
    try {
      dialog.showModal();
    } catch {
      setStatus("AI 도움을 열지 못했어요. 다시 확인해 주세요.");
      return;
    }
    openerRef.current = trigger;
    restoreFocusRef.current = true;
    const unlock = lockDocumentScroll();
    const viewport = window.visualViewport;
    function syncViewport() {
      if (!dialog) return;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      if (Number.isFinite(height) && height > 0)
        dialog.style.setProperty("--ai-viewport-height", `${height}px`);
      if (Number.isFinite(top) && top >= 0)
        dialog.style.setProperty("--ai-viewport-top", `${top}px`);
      if (
        dialog.contains(document.activeElement) &&
        document.activeElement instanceof HTMLTextAreaElement &&
        bodyRef.current
      )
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    const observer = new MutationObserver((records) => {
      // Stream text and changes inside this panel do not trigger layout reads.
      if (changedModalState(records, dialog) && hasOtherVisibleModal(dialog)) {
        closePanel(false);
        setStatus(modalConflictCopy);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open", "aria-modal", "hidden", "style", "class"],
    });
    releaseRef.current = () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      dialog.style.removeProperty("--ai-viewport-height");
      dialog.style.removeProperty("--ai-viewport-top");
      unlock();
    };
    setStatus("");
    setWideViewHref(
      buildPutdukAiWideViewHref(
        buildPutdukAiScreenContext({
          pathname,
          searchParams: new URLSearchParams(window.location.search),
        }),
      ),
    );
    setOpen(true);
  }

  return (
    <>
      <footer className={styles.dock} data-ai-dock aria-label="화면 도움">
        <div className={styles.actions}>
          {pathname === "/mining" ? (
            <a
              className={styles.detailsLink}
              href="#putduk-mining-details"
              onClick={(event) => {
                const details = Array.from(
                  document.querySelectorAll<HTMLDetailsElement>(
                    'details[id="putduk-mining-details"]',
                  ),
                ).find((node) => node.getClientRects().length > 0);
                if (!details) return;
                event.preventDefault();
                details.open = true;
                details.scrollIntoView({ block: "start", behavior: "instant" });
                details
                  .querySelector("summary")
                  ?.focus({ preventScroll: true });
              }}
            >
              상세 보기
              <span aria-hidden="true">↓</span>
            </a>
          ) : null}
          <button
            className={styles.launcher}
            type="button"
            aria-label="AI 도움"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={dialogId}
            aria-describedby={status ? statusId : undefined}
            onClick={(event) => openPanel(event.currentTarget)}
          >
            <PutdukAiMascot />
            <span>AI 도움</span>
          </button>
        </div>
        {status ? (
          <p
            className={styles.status}
            id={statusId}
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
        ) : null}
      </footer>
      <dialog
        className={styles.dialog}
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={titleId}
        data-ai-dialog
        onCancel={(event) => {
          event.preventDefault();
          closePanel();
        }}
        onClose={() => closePanel(restoreFocusRef.current)}
      >
        <header className={styles.header}>
          <div className={styles.identity}>
            <button
              className={styles.mascotClose}
              type="button"
              aria-label="AI 도움 닫기"
              onClick={() => closePanel()}
            >
              <PutdukAiMascot />
            </button>
            <h2 id={titleId}>퍼뜩 AI</h2>
          </div>
          <div className={styles.headerActions}>
            <Link
              className={styles.expandLink}
              href={wideViewHref as Route}
              onNavigate={() => closePanel(false)}
            >
              넓게 보기
            </Link>
            <button
              className={styles.closeButton}
              type="button"
              aria-label="닫기"
              onClick={() => closePanel()}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>
        <div className={styles.body} ref={bodyRef}>
          {open ? <PutdukAiChat presentation="panel" /> : null}
        </div>
      </dialog>
    </>
  );
}
