import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/design/fonts", () => ({
  putdukFont: { variable: "font-test" },
}));
vi.mock("@/components/system/pwa-registrar", () => ({
  PwaRegistrar: "pwa-runtime",
}));
vi.mock("@/components/system/analytics-beacon", () => ({
  AnalyticsBeacon: "analytics-runtime",
}));
vi.mock("@/components/system/web-vitals-beacon", () => ({
  WebVitalsBeacon: "vitals-runtime",
}));
vi.mock("@/components/system/theme-runtime", () => ({
  ThemeRuntime: "theme-runtime",
}));
vi.mock("@/components/support/support-runtime", () => ({
  SupportRuntime: "support-runtime",
}));

function elementTypes(node: ReactNode): unknown[] {
  if (Array.isArray(node)) return node.flatMap(elementTypes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node.type, ...elementTypes(node.props.children)];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("landing layout runtime boundary", () => {
  it("keeps the apex public and does not install a member service worker or send member analytics", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://putduk.com");
    vi.resetModules();
    const { default: RootLayout, metadata } = await import("@/app/layout");
    const types = elementTypes(RootLayout({ children: "public homepage" }));
    expect(types).not.toContain("pwa-runtime");
    expect(types).not.toContain("analytics-runtime");
    expect(types).not.toContain("vitals-runtime");
    expect(types).toContain("theme-runtime");
    expect(metadata.metadataBase?.toString()).toBe("https://putduk.com/");
  });

  it("retains member PWA and telemetry on the member deployment", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://mining.putduk.com");
    vi.resetModules();
    const { default: RootLayout, metadata } = await import("@/app/layout");
    const types = elementTypes(RootLayout({ children: "member page" }));
    expect(types).toEqual(
      expect.arrayContaining([
        "pwa-runtime",
        "analytics-runtime",
        "vitals-runtime",
        "theme-runtime",
      ]),
    );
    expect(metadata.metadataBase?.toString()).toBe(
      "https://mining.putduk.com/",
    );
  });
});
