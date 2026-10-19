import { createHash } from "node:crypto";
import path from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { patchCssModules } from "vite-css-modules";
import vinext from "vinext";

import nextConfig from "./next.config";

export default defineConfig({
  build: {
    sourcemap: false,
  },
  plugins: [
    patchCssModules({ exportMode: "default" }),
    // Same file as next.config.ts. Passing it in skips vinext's nested reload.
    vinext({ nextConfig }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  css: {
    modules: {
      generateScopedName(name: string, filename: string) {
        const relativePath = path
          .relative(import.meta.dirname, filename.replace(/\?.*$/, ""))
          .replaceAll("\\", "/");
        return `_${name}_${createHash("sha256").update(relativePath).digest("hex").slice(0, 7)}`;
      },
    },
  },
});
