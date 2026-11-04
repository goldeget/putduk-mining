import { extname } from "node:path";

const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".json",
  ".md",
  ".css",
  ".svg",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".txt",
  ".html",
  ".xml",
  ".webmanifest",
  ".lock",
  // Exact text types found to differ between Windows checkout and committed LF.
  ".mdc",
  ".csv",
  ".ps1",
  ".py",
  ".sh",
]);
export const canonicalPolicy = "WORKROOM_REVIEWED_TEXT_LF_V2";
export function canonicalSourceBytes(path, bytes) {
  const name = path.split("/").at(-1);
  const text =
    textExtensions.has(extname(path)) ||
    name.startsWith(".") ||
    name === "CODEOWNERS";
  if (!text) return bytes;
  // Reject lossy decoding; binary assets always retain their exact original bytes.
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw Error("WORKROOM_SOURCE_INVALID_UTF8:" + path);
  }
  if (decoded.includes("\0"))
    throw Error("WORKROOM_SOURCE_NUL_IN_TEXT:" + path);
  return Buffer.from(decoded.replaceAll("\r\n", "\n"), "utf8");
}
