import type { Page, Request, Response } from "@playwright/test";

/** No action identifiers, header values, queries or credentials enter evidence. */
export type CancelledSuccessfulLoginRedirect = {
  path: "/login";
  error: "net::ERR_ABORTED";
  observedDuringExplicitLogin: true;
  exactProductsLoginTarget: true;
  postRequest: true;
  actionHeaderPresent: true;
  fetchResource: true;
  navigation: false;
  ownedOrigin: true;
  matchingResponse: true;
  response200: true;
  rscResponse: true;
  exactProductsRedirect: true;
  authHelperSucceeded: true;
};

type LoginWindow = {
  outcome: Promise<boolean>;
  complete: (success: boolean) => void;
};

function exactOwnedProductsRedirect(value: string | undefined, origin: string) {
  if (!value) return false;
  // Installed Next emits "redirectUrl;redirectType". Accept only its known
  // canonical suffix or an unsuffixed target, never an arbitrary redirect.
  const parts = value.split(";");
  const target = parts[0];
  if (!target || /\s/.test(target) || parts.length > 2) return false;
  if (target !== "/products" && target !== `${origin}/products`) return false;
  if (parts.length === 2 && parts[1] !== "push" && parts[1] !== "replace")
    return false;
  try {
    const url = new URL(target, origin);
    return (
      url.origin === origin &&
      url.pathname === "/products" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * A very narrow observer for the successful native login action proven in V29.
 * Only actual Request objects emitted within the explicitly wrapped existing
 * loginAsMember(/products) flow can qualify. Every unknown failure stays fatal.
 */
export function observeSuccessfulProductsLogin(
  page: Page,
  ownedOrigin: string,
) {
  const origin = new URL(ownedOrigin).origin;
  const tracked = new WeakMap<Request, LoginWindow>();
  const observedResponses = new WeakMap<Request, Response>();
  let current: LoginWindow | null = null;
  const trackRequest = (request: Request) => {
    if (!current) return;
    const url = new URL(request.url());
    if (
      url.origin === origin &&
      url.pathname === "/login" &&
      [...url.searchParams].length === 1 &&
      url.searchParams.get("next") === "/products" &&
      !url.hash &&
      request.method() === "POST" &&
      request.resourceType() === "fetch" &&
      !request.isNavigationRequest() &&
      Boolean(request.headers()["next-action"]?.trim())
    )
      tracked.set(request, current);
  };
  page.on("request", trackRequest);
  // A cancelled response body can make Request.response() return null even
  // after Chromium emitted the real successful response. Keep that same
  // Request's observed response; missing response evidence still stays fatal.
  const trackResponse = (response: Response) => {
    const request = response.request();
    if (tracked.has(request)) observedResponses.set(request, response);
  };
  page.on("response", trackResponse);

  return {
    async withLoginToProducts(loginAsMember: () => Promise<void>) {
      if (current) throw new Error("EXPLICIT_LOGIN_WINDOW_ALREADY_ACTIVE");
      let complete!: (success: boolean) => void;
      const outcome = new Promise<boolean>((resolve) => {
        complete = resolve;
      });
      const window = { outcome, complete };
      current = window;
      try {
        await loginAsMember();
        const url = new URL(page.url());
        window.complete(
          url.origin === origin &&
            url.pathname === "/products" &&
            !url.search &&
            !url.hash,
        );
      } catch (error) {
        window.complete(false);
        throw error;
      } finally {
        current = null;
      }
    },
    async classifyFailed(
      request: Request,
    ): Promise<CancelledSuccessfulLoginRedirect | null> {
      const window = tracked.get(request);
      if (!window || request.failure()?.errorText !== "net::ERR_ABORTED")
        return null;
      try {
        if (!(await window.outcome)) return null;
        const response =
          observedResponses.get(request) ?? (await request.response());
        if (
          !response ||
          response.request() !== request ||
          response.status() !== 200
        )
          return null;
        const responseUrl = new URL(response.url());
        if (responseUrl.origin !== origin || responseUrl.pathname !== "/login")
          return null;
        const headers = response.headers();
        if (
          headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
            "text/x-component" ||
          !exactOwnedProductsRedirect(headers["x-action-redirect"], origin)
        )
          return null;
        return {
          path: "/login",
          error: "net::ERR_ABORTED",
          observedDuringExplicitLogin: true,
          exactProductsLoginTarget: true,
          postRequest: true,
          actionHeaderPresent: true,
          fetchResource: true,
          navigation: false,
          ownedOrigin: true,
          matchingResponse: true,
          response200: true,
          rscResponse: true,
          exactProductsRedirect: true,
          authHelperSucceeded: true,
        };
      } catch {
        // Missing/disposed/unknown response evidence never grants an exception.
        return null;
      }
    },
    dispose() {
      page.off("request", trackRequest);
      page.off("response", trackResponse);
    },
  };
}

/** Drain all emitted classifications, including those appended while awaiting. */
export async function settleBrowserClassifications(pending: Promise<void>[]) {
  let completed = 0;
  while (completed < pending.length) {
    const end = pending.length;
    await Promise.all(pending.slice(completed, end));
    completed = end;
  }
}
