import { createHmac, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  assertBackendHttp195CanonicalCandidateSources,
  assertBackendHttp195LocalCandidateSources,
} from "../../../../scripts/backend-http-195-source.mjs";
import {
  readBackend201HttpContext,
  resolveBackend201Context,
} from "../../../../scripts/backend-successor-201-http-context.mjs";

type SafeResult = {
  status: number;
  data: {
    data?: Record<string, unknown>;
    error?: { code?: string };
    ok?: boolean;
    code?: string;
    sendId?: string;
    ledgerTransactionId?: string;
  } | null;
};
const USER_AGENT = "PUTDUK-Backend-195-HTTP-Auth-Fixture";
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error("BACKEND_195_ENV_REQUIRED:" + name);
  return value;
};
export function requireBackend195Target() {
  const revision = process.env.PUTDUK_BACKEND_SOURCE_REVISION;
  const reviewed = resolveBackend201Context(
    revision,
    () =>
      process.platform === "win32"
        ? assertBackendHttp195LocalCandidateSources()
        : assertBackendHttp195CanonicalCandidateSources(),
    readBackend201HttpContext,
  );
  const url = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
  if (
    process.env.APP_ENV !== "test" ||
    (reviewed.migrationSources !== 195 &&
      !(revision === "201" && reviewed.migrationSources === 201)) ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== String(reviewed.apiPort) ||
    process.env.LOCAL_SUPABASE_PROJECT_ID !== reviewed.projectId
  )
    throw new Error("EXACT_195_TEST_TARGET_REQUIRED");
  return reviewed;
}
function adminOrigin() {
  const port = required("E2E_ADMIN_PORT");
  if (!/^[1-9][0-9]{3,4}$/.test(port) || Number(port) > 65535)
    throw new Error("LOCAL_ADMIN_PORT_REQUIRED");
  return "http://127.0.0.1:" + port;
}
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("SYNTHETIC_TOTP_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
/** Native HTTP server action + Auth MFA + server proof + registered app session.
 * Cookie/credential/TOTP/token values stay inside this closure; no storageState or logs.
 * Role grants and synthetic user setup remain separate from authorization evidence.
 */
export async function authenticateBackend195Operator(identity: {
  email: string;
  password: string;
}) {
  requireBackend195Target();
  const origin = adminOrigin();
  const jar = new Map<string, string>();
  async function raw(path: string, body?: unknown, foreignOrigin?: string) {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("RELATIVE_ADMIN_PATH_REQUIRED");
    const form = body instanceof FormData;
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: [...jar]
          .map(([name, value]) => name + "=" + encodeURIComponent(value))
          .join("; "),
        ...(body === undefined ? {} : { Origin: foreignOrigin ?? origin }),
        ...(form || body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: form ? body : JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";")[0]!;
      const index = first.indexOf("=");
      if (index > 0)
        jar.set(
          first.slice(0, index),
          decodeURIComponent(first.slice(index + 1)),
        );
    }
    const text = await response.text();
    let data: SafeResult["data"] = null;
    try {
      data = JSON.parse(text) as SafeResult["data"];
    } catch {
      /* Native login is HTML. */
    }
    return { response, text, data };
  }
  try {
    const login = await raw("/login");
    if (login.response.status !== 200)
      throw new Error("ADMIN_LOGIN_FORM_REQUIRED");
    const form = new FormData();
    for (const input of login.text.matchAll(/<input\b[^>]*>/g)) {
      const attributes: Record<string, string> = {};
      for (const match of input[0].matchAll(/([A-Za-z0-9_$:-]+)="([^"]*)"/g))
        attributes[match[1]!] = match[2]!
          .replaceAll("&quot;", '"')
          .replaceAll("&amp;", "&")
          .replaceAll("&#x27;", "'");
      if (attributes.name?.startsWith("$ACTION_"))
        form.append(attributes.name, attributes.value ?? "");
    }
    if (
      ![...form.keys()].some(
        (key) =>
          key.startsWith("$ACTION_REF_") || key.startsWith("$ACTION_ID_"),
      )
    )
      throw new Error("NATIVE_SERVER_ACTION_METADATA_REQUIRED");
    form.set("email", identity.email);
    form.set("password", identity.password);
    form.set("returnTo", "/");
    const signed = await raw("/login", form);
    if (
      signed.response.status !== 303 ||
      !signed.response.headers.get("location")?.includes("/mfa")
    )
      throw new Error("REAL_PASSWORD_SERVER_ACTION_REQUIRED");
    const aal1 = await raw("/api/v1/admin/withdrawals/command", {});
    if (aal1.response.status !== 403 || aal1.data?.code !== "MFA_REQUIRED")
      throw new Error("AAL1_FINANCE_DENIAL_REQUIRED");
    const sdk = createServerClient(
      required("NEXT_PUBLIC_SUPABASE_URL"),
      required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      {
        cookieOptions: {
          name: "putduk-admin-auth",
          path: "/",
          sameSite: "lax",
        },
        global: {
          fetch: (input, options) =>
            fetch(input, { ...options, signal: AbortSignal.timeout(30000) }),
        },
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (rows) =>
            rows.forEach((cookie) => jar.set(cookie.name, cookie.value)),
        },
      },
    );
    const enrolled = await sdk.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "195 synthetic HTTP fixture",
    });
    if (enrolled.error || !enrolled.data || !("totp" in enrolled.data))
      throw new Error("REAL_TOTP_ENROLL_REQUIRED");
    const verified = await raw("/api/v1/admin/session/totp-verify", {
      purpose: "SESSION",
      factorId: enrolled.data.id,
      code: totp(enrolled.data.totp.secret),
    });
    if (
      verified.response.status !== 200 ||
      verified.data?.data?.verified !== true
    )
      throw new Error("REAL_TOTP_SERVER_VERIFY_REQUIRED");
    const before = await raw("/api/v1/admin/session/step-up", {
      commandFamily: "WITHDRAWAL_OPERATOR",
    });
    if (
      before.response.status !== 403 ||
      before.data?.error?.code !== "ADMIN_SESSION_REQUIRED"
    )
      throw new Error("APP_SESSION_DENIAL_REQUIRED");
    const registered = await raw("/api/v1/admin/session/mfa-confirmed", {});
    if (registered.response.status !== 200)
      throw new Error("REGISTERED_ADMIN_SESSION_REQUIRED");
    return {
      async post(
        path: string,
        body: unknown,
        foreignOrigin?: string,
      ): Promise<SafeResult> {
        const result = await raw(path, body, foreignOrigin);
        return { status: result.response.status, data: result.data };
      },
      async stepUp() {
        const issued = await raw("/api/v1/admin/session/step-up", {
          commandFamily: "WITHDRAWAL_OPERATOR",
        });
        const token = issued.data?.data?.token;
        if (
          issued.response.status !== 200 ||
          typeof token !== "string" ||
          token.length < 16
        )
          throw new Error("REAL_HTTP_STEP_UP_REQUIRED");
        return token;
      },
      async command(body: Record<string, unknown>) {
        const token = await this.stepUp();
        return this.post("/api/v1/admin/withdrawals/command", {
          ...body,
          stepUpToken: token,
        });
      },
      nonce: randomUUID(),
    };
  } catch {
    throw new Error("BACKEND_195_REAL_HTTP_AUTH_SETUP_FAILED");
  }
}

/** No auth cookies are sent. The network destination remains the exact local app. */
export async function unauthenticatedBackend195Command(body: unknown) {
  requireBackend195Target();
  const origin = adminOrigin();
  const response = await fetch(origin + "/api/v1/admin/withdrawals/command", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
    headers: {
      Origin: origin,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    data: (await response.json()) as SafeResult["data"],
  };
}
