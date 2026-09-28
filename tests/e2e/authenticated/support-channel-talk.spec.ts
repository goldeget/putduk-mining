import { expect, type Page, test } from "@playwright/test";

import { createChannelMemberHash } from "../../../lib/support/member-hash";
import { createConfirmedMember } from "../fixtures/local-auth";
import { loginAsMember } from "./helpers/member-session";

const secret = "aa".repeat(32);

type SupportLogEntry = {
  type: string;
  option?: { memberId?: string; memberHash?: string; profile?: object };
};

async function installSupportPort(page: Page) {
  await page.addInitScript(() => {
    const log: Array<Record<string, unknown>> = [];
    (
      window as Window & {
        __PUTDUK_SUPPORT_LOG__?: Array<Record<string, unknown>>;
      }
    ).__PUTDUK_SUPPORT_LOG__ = log;
    (
      window as Window & {
        __PUTDUK_SUPPORT_PORT__?: object;
      }
    ).__PUTDUK_SUPPORT_PORT__ = {
      async boot(option: object) {
        log.push({ type: "boot", option });
      },
      async shutdown() {
        log.push({ type: "shutdown" });
      },
      async setPage(pageName: string) {
        log.push({ type: "setPage", page: pageName });
      },
      async track(name: string) {
        log.push({ type: "track", name });
      },
      async setAppearance(appearance: string) {
        log.push({ type: "setAppearance", appearance });
      },
      async showMessenger() {
        log.push({ type: "showMessenger" });
      },
    };
  });
}

async function readLog(page: Page) {
  return page.evaluate(
    () =>
      ((window as Window & { __PUTDUK_SUPPORT_LOG__?: SupportLogEntry[] })
        .__PUTDUK_SUPPORT_LOG__ ?? []) as SupportLogEntry[],
  );
}

async function waitForBoot(page: Page, memberId?: string) {
  await page.waitForFunction(
    (expected) => {
      const log =
        (
          window as Window & {
            __PUTDUK_SUPPORT_LOG__?: Array<{
              type: string;
              option?: { memberId?: string };
            }>;
          }
        ).__PUTDUK_SUPPORT_LOG__ ?? [];
      const boots = log.filter((entry) => entry.type === "boot");
      const last = boots.at(-1);
      if (!last) {
        return false;
      }
      return expected
        ? last.option?.memberId === expected
        : !last.option?.memberId;
    },
    memberId,
    { timeout: 30_000 },
  );
}

function boxesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) {
  return !(
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y ||
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x
  );
}

test("member support identity does not leak across login", async ({ page }) => {
  const memberA = await createConfirmedMember("support-a");
  const memberB = await createConfirmedMember("support-b");
  await installSupportPort(page);

  await page.goto("/support");
  await waitForBoot(page);
  const anonymous = await readLog(page);
  expect(anonymous.some((entry) => entry.option?.memberId)).toBe(false);
  const anonymousResponse = await page.request.get(
    "/api/v1/support/channel-session?userId=00000000-0000-4000-8000-000000000099",
  );
  expect(anonymousResponse.status()).toBe(200);
  const anonymousBody = (await anonymousResponse.json()) as {
    mode?: string;
    memberId?: string;
  };
  expect(anonymousBody).toEqual({ mode: "anonymous" });

  await loginAsMember(page, memberA, "/home");
  await waitForBoot(page, memberA.userId);
  await page.goto("/support");
  await waitForBoot(page, memberA.userId);
  await expect(
    page.getByRole("heading", { name: "필요한 도움을 바로 확인해요." }),
  ).toBeVisible();
  const memberBody = (await (
    await page.request.get(
      "/api/v1/support/channel-session?userId=00000000-0000-4000-8000-000000000099",
    )
  ).json()) as {
    memberHash?: string;
    memberId?: string;
    mode?: string;
    profile?: Record<string, unknown>;
  };
  expect(memberBody.mode).toBe("member");
  expect(memberBody.memberId).toBe(memberA.userId);
  expect(memberBody.memberHash).toBe(
    createChannelMemberHash(memberA.userId, secret),
  );
  expect(memberBody.profile).not.toHaveProperty("email");
  expect(memberBody.profile).not.toHaveProperty("balance");
  expect(JSON.stringify(memberBody)).not.toContain(secret);
  expect(JSON.stringify(memberBody)).not.toContain(
    "00000000-0000-4000-8000-000000000099",
  );

  await page.goto("/menu/account");
  await page.getByRole("button", { name: "이 기기에서 로그아웃" }).click();
  await page.waitForURL(/\/login/);
  await waitForBoot(page);
  const loggedOut = await readLog(page);
  const loggedOutBoot = loggedOut
    .filter((entry) => entry.type === "boot")
    .at(-1);
  expect(loggedOutBoot?.option?.memberId).toBeUndefined();

  await loginAsMember(page, memberB, "/home");
  await waitForBoot(page, memberB.userId);
  const memberLog = await readLog(page);
  const boots = memberLog.filter((entry) => entry.type === "boot");
  const lastBoot = boots.at(-1);
  expect(lastBoot?.option?.memberId).toBe(memberB.userId);
  expect(lastBoot?.option?.memberHash).toBe(
    createChannelMemberHash(memberB.userId, secret),
  );
  const memberABoot = memberLog.findIndex(
    (entry) => entry.option?.memberId === memberA.userId,
  );
  const memberBBoot = memberLog.findIndex(
    (entry) => entry.option?.memberId === memberB.userId,
  );
  if (memberABoot >= 0) {
    expect(memberBBoot).toBeGreaterThan(memberABoot);
    expect(
      memberLog
        .slice(memberABoot, memberBBoot)
        .some((entry) => entry.type === "shutdown"),
    ).toBe(true);
  } else {
    expect(JSON.stringify(lastBoot)).not.toContain(memberA.userId);
  }

  const width = page.viewportSize()?.width ?? 1280;
  await page.goto("/home");
  const launcher = page.locator("#putduk-support-launcher");
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox).not.toBeNull();
  if (width < 980 && launcherBox) {
    const navigation = page.locator(".product-workspace > .product-navigation");
    const navigationBox = await navigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    if (navigationBox) {
      expect(boxesOverlap(launcherBox, navigationBox)).toBe(false);
    }
  }
});
