import { createInterface } from "node:readline";

import { redactSupabaseCliLine } from "./capture-local-supabase-env.mjs";

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

lines.on("line", (line) => {
  try {
    process.stdout.write(`${redactSupabaseCliLine(line)}\n`);
  } catch {
    process.stdout.write("[redacted line]\n");
  }
});
