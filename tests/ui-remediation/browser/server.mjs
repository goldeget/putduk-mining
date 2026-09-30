import { createReadStream } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { themeBootstrap } from "../../../lib/design/theme.ts";

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(fixtureRoot, "../../..");
const require = createRequire(import.meta.url);
const { createServer } = await import(
  pathToFileURL(require.resolve("vite")).href
);

const stubs = (name) => path.join(fixtureRoot, "stubs", name);
const actionModules = new Set([
  path.join(projectRoot, "app/login/actions.ts"),
  path.join(projectRoot, "app/signup/actions.ts"),
  path.join(projectRoot, "app/auth/update-password/actions.ts"),
  path.join(projectRoot, "apps/admin/app/(control)/kyc/actions.ts"),
]);

const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixtureRoot,
  publicDir: path.join(projectRoot, "public"),
  cacheDir: path.join(projectRoot, ".vite/ui-remediation-browser"),
  esbuild: { jsx: "automatic" },
  css: { postcss: projectRoot },
  server: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  plugins: [
    {
      name: "putduk-local-fixture-boundaries",
      enforce: "pre",
      transformIndexHtml() {
        return [{ tag: "script", children: themeBootstrap, injectTo: "head" }];
      },
      resolveId(specifier, importer) {
        if (specifier === "next/link") return stubs("link.jsx");
        if (specifier === "next/navigation") return stubs("navigation.js");
        if (specifier === "server-only" || specifier === "next/headers") {
          throw new Error(
            `Server module is forbidden in a client-only fixture: ${specifier}`,
          );
        }
        let target;
        if (specifier.startsWith("@/")) {
          const base = importer?.replaceAll("\\", "/").includes("/apps/admin/")
            ? path.join(projectRoot, "apps/admin")
            : projectRoot;
          target = path.resolve(base, specifier.slice(2));
        } else if (specifier.startsWith(".") && importer) {
          target = path.resolve(path.dirname(importer), specifier);
        }
        if (!target) return null;
        const normalized = path
          .normalize(target)
          .replace(/\.(?:tsx?|jsx?)$/, "");
        if (actionModules.has(`${normalized}.ts`)) return stubs("actions.js");
        if (
          normalized ===
          path.join(projectRoot, "apps/admin/lib/supabase/browser")
        )
          return stubs("admin-browser.js");
        if (normalized === path.join(projectRoot, "lib/analytics/client"))
          return stubs("analytics.js");
        if (specifier.startsWith("@/"))
          return this.resolve(target, importer, { skipSelf: true });
        return null;
      },
      configureServer(viteServer) {
        viteServer.middlewares.use((request, response, next) => {
          if (
            request.url?.startsWith("/api/") ||
            !["GET", "HEAD"].includes(request.method ?? "GET")
          ) {
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: { code: "LOCAL_FIXTURE_COMMAND_BLOCKED" },
              }),
            );
            return;
          }
          next();
        });
        viteServer.middlewares.use(
          "/fixture-font.woff2",
          (_request, response) => {
            response.setHeader("Content-Type", "font/woff2");
            response.setHeader("Cache-Control", "no-store");
            const fontStream = createReadStream(
              path.join(projectRoot, "assets/fonts/PretendardVariable.woff2"),
            );
            fontStream.on("error", () => {
              response.statusCode = 404;
              response.end("Fixture font file is unavailable");
            });
            fontStream.pipe(response);
          },
        );
      },
    },
  ],
});

await server.listen();
console.info(
  "PUTDUK client-only fixture: http://127.0.0.1:4175/?fixture=motion",
);
console.info(
  "All server actions, auth SDK operations and component fetch requests are mocked locally.",
);
async function close() {
  await server.close();
  process.exit(0);
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
