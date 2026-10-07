import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createReadStream } from "node:fs";

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(fixtureRoot, "../../../..");
const require = createRequire(import.meta.url);
const { createServer } = await import(
  pathToFileURL(require.resolve("vite")).href
);
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fixtureRoot,
  publicDir: false,
  cacheDir: path.join(projectRoot, ".vite/admin-release"),
  esbuild: { jsx: "automatic" },
  css: { postcss: projectRoot },
  server: {
    host: "127.0.0.1",
    port: 4186,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  plugins: [
    {
      name: "admin-only-component-boundary",
      enforce: "pre",
      resolveId(specifier, importer) {
        if (specifier === "@/app/actions")
          return "\0fixture:admin-auth-actions";
        if (["server-only", "next/headers"].includes(specifier))
          throw new Error(
            `Server code forbidden in isolated UI QA: ${specifier}`,
          );
        if (specifier === "next/link" || specifier === "next/navigation")
          return `\0fixture:${specifier}`;
        if (specifier.startsWith("@/"))
          return this.resolve(
            path.join(projectRoot, "apps/admin", specifier.slice(2)),
            importer,
            { skipSelf: true },
          );
        return null;
      },
      load(id) {
        if (id === "\0fixture:admin-auth-actions")
          return 'export function logoutAction(){throw new Error("Auth commands blocked in isolated component QA");} export function logoutAllAction(){throw new Error("Auth commands blocked in isolated component QA");}';
        if (id === "\0fixture:next/link")
          return `import {createElement} from "react"; export default function Link({href,children,onClick,...props}){return createElement("a",{...props,href:String(href),onClick(event){event.preventDefault();onClick?.(event);}},children);}`;
        if (id === "\0fixture:next/navigation")
          return `export function usePathname(){const section=new URLSearchParams(location.search).get("section")??"today";return section==="today"?"/":section==="members"?"/members":"/operations/"+section;} export function useRouter(){return {refresh(){window.__ADMIN_FIXTURE_REFRESHES__=(window.__ADMIN_FIXTURE_REFRESHES__??0)+1;}};}`;
        return null;
      },
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (
            request.url?.startsWith("/api/") ||
            !["GET", "HEAD"].includes(request.method ?? "GET")
          ) {
            response.statusCode = 503;
            response.end("No server commands in isolated UI QA");
            return;
          }
          next();
        });
        vite.middlewares.use("/fixture-font.woff2", (_request, response) => {
          response.setHeader("Content-Type", "font/woff2");
          const font = createReadStream(
            path.join(projectRoot, "assets/fonts/PretendardVariable.woff2"),
          );
          font.on("error", () => {
            response.statusCode = 404;
            response.end("Font unavailable");
          });
          font.pipe(response);
        });
      },
    },
  ],
});
await server.listen();
console.info(
  "Admin isolated component QA: http://127.0.0.1:4186 — synthetic data, no auth/DB/API",
);
async function close() {
  await server.close();
  process.exit(0);
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
