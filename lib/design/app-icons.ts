import type { Metadata, MetadataRoute } from "next";

// Change delivery URLs to bypass previously cached empty or redirected responses.
// The approved artwork bytes, manifest app identity and launch URL stay stable.
const deliveryRevision = "20261020-icon1";
const delivered = (path: string) => `${path}?v=${deliveryRevision}`;
const identityRoot = "/brand/identity/20261014";

export const APP_ICONS = {
  icon: [
    {
      url: delivered(`${identityRoot}/favicon/favicon.svg`),
      sizes: "any",
      type: "image/svg+xml",
    },
    {
      url: delivered(`${identityRoot}/favicon/favicon-32.png`),
      sizes: "32x32",
      type: "image/png",
    },
  ],
  shortcut: delivered(`${identityRoot}/favicon/favicon.ico`),
  apple: [
    {
      url: delivered(`${identityRoot}/pwa/putduk-pwa-maskable-512.png`),
      sizes: "512x512",
      type: "image/png",
    },
  ],
} satisfies NonNullable<Metadata["icons"]>;

export const APP_MANIFEST_ICONS = [
  {
    src: delivered(`${identityRoot}/pwa/putduk-pwa-dark-192.png`),
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: delivered(`${identityRoot}/pwa/putduk-pwa-dark-512.png`),
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: delivered(`${identityRoot}/pwa/putduk-pwa-maskable-512.png`),
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
] satisfies NonNullable<MetadataRoute.Manifest["icons"]>;
