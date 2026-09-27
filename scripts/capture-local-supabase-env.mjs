import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const REMOTE_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";

function readStatusEnv() {
  const output = execFileSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function requireLocal(values, names) {
  for (const name of names) {
    if (values[name]) {
      return values[name];
    }
  }
  throw new Error(`Local Supabase status is missing ${names.join(" or ")}.`);
}

const status = readStatusEnv();
const apiUrl = requireLocal(status, ["API_URL", "SUPABASE_URL"]);
const publishableKey = requireLocal(status, [
  "ANON_KEY",
  "SUPABASE_ANON_KEY",
  "PUBLISHABLE_KEY",
]);
const secretKey = requireLocal(status, [
  "SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SECRET_KEY",
]);

if (apiUrl.includes(REMOTE_PROJECT_REF) || !apiUrl.startsWith("http://")) {
  throw new Error(
    "Refusing remote Supabase credentials. Authenticated CI uses the local API only.",
  );
}

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  `SUPABASE_SECRET_KEY=${secretKey}`,
];

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
} else {
  process.stdout.write(`${lines.join("\n")}\n`);
}
