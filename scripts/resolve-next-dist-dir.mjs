import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedProjects = new Set([
  repositoryRoot,
  join(repositoryRoot, "apps", "admin"),
]);

/** Fresh in-project output avoids following an existing external cache link. */
export function resolveNextDistDir(projectDirectory = process.cwd()) {
  const projectRoot = resolve(projectDirectory);
  if (!allowedProjects.has(projectRoot))
    throw new Error("NEXT_BUILD_PROJECT_SCOPE_INVALID");
  const name = process.env.PUTDUK_NEXT_DIST_DIR ?? ".next";
  if (!/^\.next(?:-qa-[a-z0-9-]{1,64})?$/.test(name))
    throw new Error("NEXT_BUILD_DIRECTORY_INVALID");
  try {
    if (lstatSync(join(projectRoot, name)).isSymbolicLink())
      throw new Error("NEXT_BUILD_OUTPUT_LINK_FORBIDDEN");
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  return name;
}
