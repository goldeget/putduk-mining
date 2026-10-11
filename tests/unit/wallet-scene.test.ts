// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WalletScene } from "@/components/product/wallet-scene";
import { WalletReadView } from "@/components/product/wallet-read-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

const themeState = vi.hoisted(() => ({ value: "dark" as "dark" | "light" }));
vi.mock("@/lib/design/use-resolved-theme", () => ({
  useResolvedTheme: () => themeState.value,
}));

function markup(theme: "dark" | "light", priority = false) {
  themeState.value = theme;
  return renderToStaticMarkup(createElement(WalletScene, { priority }));
}

describe("Wallet native scene contract", () => {
  it("binds reviewed mobile941 and landscape tablet/desktop vault families", () => {
    const html = markup("dark");
    expect(html).toContain('data-scene-theme="dark"');
    expect(html).toContain('media="(min-width: 640px)"');
    for (const width of [480, 640, 941])
      expect(html).toContain(
        `wallet-vault-mobile-dark-${width}-v1.avif ${width}w`,
      );
    for (const width of [960, 1280, 1536, 1920])
      expect(html).toContain(
        `wallet-vault-desktop-dark-${width}-v1.webp ${width}w`,
      );
    expect(html).toContain('width="941" height="1672"');
    expect(html).not.toMatch(
      /wallet-chip|wallet-vault-mobile-dark-960|http:|https:/,
    );
    expect(html.indexOf("wallet-vault-desktop-dark")).toBeLessThan(
      html.indexOf("wallet-vault-mobile-dark"),
    );
  });
  it("uses the true Light940 native width and distinct reviewed desktop adaptation", () => {
    const html = markup("light");
    expect(html).toContain('data-scene-theme="light"');
    expect(html).toContain('width="940" height="1672"');
    for (const width of [480, 640, 940])
      expect(html).toContain(
        `wallet-chip-mobile-light-${width}-v1.webp ${width}w`,
      );
    for (const width of [960, 1280, 1536, 1920])
      expect(html).toContain(
        `wallet-chip-desktop-light-${width}-v1.avif ${width}w`,
      );
    expect(html).not.toMatch(
      /wallet-vault|wallet-chip-mobile-light-941|wallet-chip-mobile-light-960/,
    );
  });
  it("preserves eager priority only when requested and keeps fallback async/lazy otherwise", () => {
    expect(markup("dark")).toContain('loading="lazy"');
    expect(markup("dark")).not.toContain('fetchPriority="high"');
    const high = markup("dark", true);
    expect(high).toContain('loading="eager"');
    expect(high).toContain('fetchPriority="high"');
    expect(high).toContain('decoding="async"');
  });
  it("keeps scene decorative with empty alt, no raster UI data or safety/return claim", () => {
    for (const theme of ["dark", "light"] as const) {
      const html = markup(theme);
      expect(html).toMatch(
        /<div[^>]*data-wallet-decoration="native-scene"[^>]*aria-hidden="true"/,
      );
      expect(html).toMatch(/<img[^>]*alt=""[^>]*aria-hidden="true"/);
      expect(html.match(/<source /g)).toHaveLength(4);
      expect(html).not.toMatch(
        /<svg|<canvas|<script|role="(?:status|progressbar)"|수익률|보장|안전|KRW|USDT/,
      );
    }
  });
  it("keeps full mobile frames, allows only the reviewed tablet focal crop and hides forced-color decoration", () => {
    const css = readFileSync(
      "components/product/wallet-scene.module.css",
      "utf8",
    );
    expect(css).toMatch(/object-fit:\s*contain/);
    const tablet = css.match(
      /@media\s*\(min-width:\s*640px\)\s*and\s*\(max-width:\s*1099px\)\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(tablet).toMatch(/object-fit:\s*cover/);
    expect(tablet).toMatch(/object-position:\s*70% top/);
    expect(css.replace(tablet!, "")).not.toMatch(/object-fit:\s*cover/);
    expect(css).not.toMatch(/filter:|transform:|mix-blend-mode:/);
    expect(css).toMatch(
      /@media\s*\(forced-colors:\s*active\)[\s\S]*display:\s*none/,
    );
    const view = readFileSync(
      "components/product/wallet-read-view.tsx",
      "utf8",
    );
    expect(view).toContain("<WalletScene priority />");
    expect(view).not.toContain("<WalletArtwork");
  });
  it("isolates theme-only client logic from unchanged server financial presentation", () => {
    const scene = readFileSync("components/product/wallet-scene.tsx", "utf8");
    const view = readFileSync(
      "components/product/wallet-read-view.tsx",
      "utf8",
    );
    expect(scene).toMatch(/^"use client"/);
    expect(scene).toContain("useResolvedTheme()");
    expect(scene).not.toMatch(
      /supabase|fetch\(|availableAtomic|amountAtomic|sessionStorage|localStorage|idempotency|innerHTML/,
    );
    expect(view).not.toMatch(/^["']use client|useState|useEffect|fetch\(/);
    expect(view).toContain('formatAtomicAmount(krw.availableAtomic, "KRW")');
    expect(view).toContain('formatAtomicAmount(krw.heldAtomic, "KRW")');
    expect(view).toContain('formatAtomicAmount(krw.balanceAtomic, "KRW")');
  });
});

const mountedRoots: Root[] = [];
afterEach(async () => {
  for (const root of mountedRoots) await act(async () => root.unmount());
  mountedRoots.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mountScene(theme: "dark" | "light", desktop = false) {
  themeState.value = theme;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: desktop,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  await act(async () =>
    root.render(
      createElement(WalletScene, { priority: true, className: undefined }),
    ),
  );
  return { host, root };
}
async function failImage(host: HTMLElement) {
  const image = host.querySelector("img");
  expect(image).not.toBeNull();
  await act(async () => image!.dispatchEvent(new Event("error")));
}

describe("Wallet native onError recovery", () => {
  it.each([
    ["dark", false, "wallet-vault-mobile-dark", 640, 941, 1672],
    ["dark", true, "wallet-vault-desktop-dark", 1280, 1983, 793],
    ["light", false, "wallet-chip-mobile-light", 640, 940, 1672],
    ["light", true, "wallet-chip-desktop-light", 1280, 1983, 793],
  ] as const)(
    "tries exactly the lossless %s/%s viewport fallback after responsive format failure",
    async (theme, desktop, family, width, nativeWidth, nativeHeight) => {
      const { host } = await mountScene(theme, desktop);
      expect(host.querySelectorAll("source")).toHaveLength(4);
      await failImage(host);
      expect(
        host.querySelector('[data-wallet-scene-state="webp"]'),
      ).not.toBeNull();
      expect(host.querySelectorAll("source")).toHaveLength(0);
      const fallback = host.querySelector("img")!;
      expect(fallback.getAttribute("src")).toBe(
        `/brand/scenes/${family}/${family}-${width}-v1.webp`,
      );
      expect(fallback.getAttribute("width")).toBe(String(nativeWidth));
      expect(fallback.getAttribute("height")).toBe(String(nativeHeight));
      expect(host.querySelector("button")).toBeNull();
    },
  );
  it("removes the twice-failed image, exposes an accessible decoration-only notice and explicit focusable retry", async () => {
    const { host } = await mountScene("dark");
    await failImage(host);
    await failImage(host);
    expect(
      host.querySelector('[data-wallet-scene-state="unavailable"]'),
    ).not.toBeNull();
    expect(host.querySelector("img,source")).toBeNull();
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("지갑 배경을 불러오지 못했어요");
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    expect(status.textContent).not.toMatch(
      /잔액|입금|출금|확인할 수 없음|KRW|USDT/,
    );
    const retry = host.querySelector("button")!;
    expect(retry.textContent).toBe("배경 다시 불러오기");
    expect(retry.closest('[aria-hidden="true"]')).toBeNull();
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await act(async () => Promise.resolve());
    expect(host.querySelector("img")).toBeNull();
  });
  it("retries only after explicit user action, refreshes the immutable URL and never sends a money request", async () => {
    const fetch = vi.fn(() => {
      throw new Error("UNEXPECTED_FETCH");
    });
    vi.stubGlobal("fetch", fetch);
    const { host } = await mountScene("light");
    await failImage(host);
    await failImage(host);
    await act(async () => host.querySelector("button")!.click());
    expect(
      host.querySelector('[data-wallet-scene-state="responsive"]'),
    ).not.toBeNull();
    expect(host.querySelectorAll("source")).toHaveLength(4);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/scenes/wallet-chip-mobile-light/wallet-chip-mobile-light-640-v1.webp?wallet-art-retry=1",
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
    await failImage(host);
    await failImage(host);
    expect(host.querySelector("img")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resets failed Dark artwork when the live theme switches to reviewed Light and does not carry the old failure", async () => {
    const { host, root } = await mountScene("dark", true);
    await failImage(host);
    await failImage(host);
    themeState.value = "light";
    await act(async () =>
      root.render(createElement(WalletScene, { priority: true })),
    );
    expect(
      host.querySelector('[data-wallet-scene-state="responsive"]'),
    ).not.toBeNull();
    expect(host.querySelector("img")?.getAttribute("width")).toBe("940");
    expect(host.innerHTML).not.toContain("wallet-vault");
    expect(host.querySelector("button")).toBeNull();
  });
  it("keeps art in an absolute background layer with a reachable retry and reading-space recovery", () => {
    const css = readFileSync(
      "components/product/wallet-read-view.module.css",
      "utf8",
    );
    const sceneCss = readFileSync(
      "components/product/wallet-scene.module.css",
      "utf8",
    );
    expect(css).toMatch(
      /\.sceneLayer\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s,
    );
    expect(css).not.toMatch(/\.sceneLayer\s*\{[^}]*z-index:\s*-1/s);
    expect(css).toContain(
      '.overview:has([data-wallet-scene-state="unavailable"]) .heading',
    );
    expect(sceneCss).toMatch(/\.recovery\s*\{[^}]*pointer-events:\s*auto/s);
    expect(sceneCss).toMatch(/\.recovery button:focus-visible/);
    const view = readFileSync(
      "components/product/wallet-read-view.tsx",
      "utf8",
    );
    expect(view).not.toContain(
      '<div className={styles.sceneLayer} aria-hidden="true">',
    );
  });
  it("keeps genuine wallet amounts, histories and entry URLs unchanged after both art failures", async () => {
    const { host, root } = await mountScene("dark");
    await act(async () =>
      root.render(
        createElement(WalletReadView, {
          balanceState: "ready",
          funding: { state: "empty" },
          krw: {
            availableAtomic: "5000",
            balanceAtomic: "7000",
            heldAtomic: "2000",
            walletAccountId: "scene-error-read-only",
          },
          ledgerEntries: [
            {
              id: "scene-error-entry",
              amountAtomic: "5000",
              direction: "CREDIT",
              entryType: "WELCOME_REWARD",
              createdAt: "2026-10-06T00:00:00.000Z",
            },
          ],
          ledgerState: "ready",
          receiptState: "empty",
          receipts: [],
          trialRewardAtomic: "0",
          trialState: "empty",
        }),
      ),
    );
    const wallet = host.querySelector('[aria-label="실제 KRW 지갑"]')!;
    const before = wallet.textContent;
    await failImage(host);
    await failImage(host);
    expect(wallet.textContent).toBe(before);
    expect(wallet.textContent).toContain("5,000원");
    expect(wallet.textContent).toContain("2,000원");
    expect(wallet.textContent).toContain("7,000원");
    expect(
      host.querySelector('[aria-labelledby="ledger-history-title"]')
        ?.textContent,
    ).toContain("+5,000 KRW");
    expect(
      host.querySelector('[aria-labelledby="wallet-receipts-title"]')
        ?.textContent,
    ).toContain("아직 입출금 처리 내역이 없어요");
    expect(host.querySelector('a[href="/wallet/deposit"]')?.textContent).toBe(
      "입금하기",
    );
    expect(host.querySelector('a[href="/wallet/withdraw"]')?.textContent).toBe(
      "출금하기",
    );
    expect(
      host.querySelector('[data-wallet-decoration-status="unavailable"]'),
    ).not.toBeNull();
    expect(
      host
        .querySelector('[data-wallet-decoration-status="unavailable"]')
        ?.closest('[aria-hidden="true"]'),
    ).toBeNull();
    expect(host.textContent).not.toContain("지갑을 불러오지 못했어요");
  });
});
