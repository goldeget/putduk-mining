"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
  usableOperatorDraft,
  type UsdtOperatorDraft,
} from "@/lib/assistant/draft";
import {
  createAdminBrowserClient,
  type AdminPublicBrowserConfig,
} from "@/lib/supabase/browser";

type DraftContext = {
  readonly publicConfig: Readonly<AdminPublicBrowserConfig>;
  draft: UsdtOperatorDraft | null;
  epoch: number;
  clearedReason: "EXPIRED" | "SESSION" | "CONNECTION" | null;
  ticket: () => number;
  save: (value: unknown, ticket: number) => boolean;
  clear: () => void;
};
const Context = createContext<DraftContext | null>(null);

/** Session-owned memory only: no URL, localStorage, model or durable cache. */
export function OperatorDraftProvider({
  children,
  userId,
  publicConfig,
}: {
  children?: React.ReactNode;
  userId: string;
  publicConfig: AdminPublicBrowserConfig;
}) {
  const [draft, setDraft] = useState<UsdtOperatorDraft | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [clearedReason, setClearedReason] =
    useState<DraftContext["clearedReason"]>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const ownerActive = useRef(true);

  function clear() {
    generation.current += 1;
    setEpoch(generation.current);
    setDraft(null);
    setClearedReason(null);
  }

  useEffect(() => {
    alive.current = true;
    ownerActive.current = true;
    function invalidate() {
      generation.current += 1;
      setEpoch(generation.current);
      setDraft(null);
      setClearedReason("CONNECTION");
    }
    window.addEventListener("offline", invalidate);
    window.addEventListener("pagehide", invalidate);
    let unsubscribe: (() => void) | undefined;
    try {
      const subscription = createAdminBrowserClient(
        publicConfig,
      ).auth.onAuthStateChange((event, session) => {
        if (
          event === "SIGNED_OUT" ||
          event === "USER_UPDATED" ||
          (event === "SIGNED_IN" && session?.user.id !== userId)
        ) {
          ownerActive.current = false;
          invalidate();
          setClearedReason("SESSION");
        }
      });
      unsubscribe = () => subscription.data.subscription.unsubscribe();
    } catch {
      ownerActive.current = false;
      // Report an external subscription failure after setup, without accepting a draft.
      queueMicrotask(() => {
        if (alive.current) {
          invalidate();
          setClearedReason("SESSION");
        }
      });
    }
    return () => {
      alive.current = false;
      generation.current += 1;
      unsubscribe?.();
      window.removeEventListener("offline", invalidate);
      window.removeEventListener("pagehide", invalidate);
    };
  }, [userId, publicConfig]);

  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(
      () => {
        generation.current += 1;
        setEpoch(generation.current);
        setDraft(null);
        setClearedReason("EXPIRED");
      },
      Math.max(0, Date.parse(draft.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [draft]);

  function save(value: unknown, ticket: number) {
    const valid = usableOperatorDraft(value);
    if (
      !valid ||
      !alive.current ||
      !ownerActive.current ||
      !navigator.onLine ||
      ticket !== generation.current
    )
      return false;
    setDraft(valid);
    setClearedReason(null);
    return true;
  }

  return (
    <Context
      value={{
        publicConfig,
        draft,
        epoch,
        clearedReason,
        ticket: () => generation.current,
        save,
        clear,
      }}
    >
      {children}
    </Context>
  );
}

export function useOperatorDraft(): DraftContext {
  const value = useContext(Context);
  if (!value) throw new Error("Operator draft session boundary is required");
  return value;
}

/** Writing-only drafts share the same session invalidation, without financial draft access. */
export function useOperatorDraftSignals(): Pick<
  DraftContext,
  "epoch" | "clearedReason"
> | null {
  const value = useContext(Context);
  return value
    ? { epoch: value.epoch, clearedReason: value.clearedReason }
    : null;
}

/** Control pages share the server-validated public tuple; auth screens may stand alone. */
export function useAdminPublicBrowserConfig(): Readonly<AdminPublicBrowserConfig> | null {
  return useContext(Context)?.publicConfig ?? null;
}
