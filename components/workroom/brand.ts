/** Canonical existing W: all active app and installed-app icons share this geometry. */
export const WORKROOM_MARK = {
  viewBox: "0 0 44 44",
  path: "m9 15 6 15 7-12 7 12 6-15",
  background: "#0c1727",
  stroke: "#73efc3",
  strokeWidth: 3.2,
  radius: 11,
} as const;
export const WORKROOM_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${WORKROOM_MARK.viewBox}"><rect width="44" height="44" rx="${WORKROOM_MARK.radius}" fill="${WORKROOM_MARK.background}"/><path d="${WORKROOM_MARK.path}" fill="none" stroke="${WORKROOM_MARK.stroke}" stroke-width="${WORKROOM_MARK.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const WORKROOM_ICON = "/workroom-icon.svg?v=workroom-w1";
export const WORKROOM_METADATA_ICONS = {
  icon: [
    { url: WORKROOM_ICON, type: "image/svg+xml", sizes: "any" },
    { url: "/workroom-favicon-32.png", type: "image/png", sizes: "32x32" },
  ],
  shortcut: "/workroom-favicon.ico",
  apple: [
    { url: "/workroom-apple-180.png", type: "image/png", sizes: "180x180" },
  ],
};
export const WORKROOM_PWA_ICONS = [
  {
    src: "/workroom-icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any" as const,
  },
  {
    src: "/workroom-icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any" as const,
  },
  {
    src: "/workroom-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable" as const,
  },
];
