import { createHash } from "node:crypto";
import path from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, loadEnv } from "vite";
import { patchCssModules } from "vite-css-modules";
import vinext from "vinext";
import {
  productionTarget,
  productionValues,
} from "./scripts/production-cloudflare-policy.mjs";

export default defineConfig(async ({ mode }) => {
  const production = productionTarget(mode, "member");
  if (production) {
    // The release runner uses Vite's programmatic API so Vinext's early CLI
    // dotenv loader cannot import local credentials before this config runs.
    Object.assign(
      process.env,
      productionValues(
        process.env.PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
        production.role,
      ),
    );
  } else {
    const loaded = loadEnv(mode, import.meta.dirname, "");
    for (const [key, value] of Object.entries(loaded)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
  const { default: nextConfig } = await import("./next.config");
  return {
    ...(production ? { envDir: false as const } : {}),
    build: {
      sourcemap: false,
    },
    plugins: [
      patchCssModules({ exportMode: "default" }),
      vinext({ nextConfig: nextConfig as never }),
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
  };
});
