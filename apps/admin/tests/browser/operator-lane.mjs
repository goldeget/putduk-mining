import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const origin = "http://127.0.0.1:4186";
const output = path.join(project, "test-results/admin-release-component-qa");
await fs.mkdir(output, { recursive: true });
const sources = [
  "apps/admin/components/admin-navigation.tsx",
  "apps/admin/components/admin-shell.tsx",
  "components/system/theme-control.tsx",
  "apps/admin/components/assistant/screen-guide.tsx",
  "apps/admin/components/assistant/operator-draft-provider.tsx",
  "apps/admin/lib/operations/registry.ts",
  "apps/admin/app/globals.css",
  "apps/admin/components/operations/operations-view.tsx",
  "apps/admin/components/operations/draft-composer.tsx",
  "apps/admin/components/operations/operator-checklist.tsx",
  "apps/admin/components/operations/operations.module.css",
  "apps/admin/components/assistant/operational-brief.tsx",
  "apps/admin/lib/operations/daily-brief.ts",
  "apps/admin/components/today/today-view.tsx",
  "apps/admin/components/today/today.module.css",
  "apps/admin/app/(control)/_lib/today-snapshot.ts",
  "apps/admin/components/members/member-directory.tsx",
  "apps/admin/tests/browser/fixture.jsx",
  "apps/admin/tests/browser/server.mjs",
  "apps/admin/tests/browser/operator-lane.mjs",
  "apps/admin/tests/browser/index.html",
  "lib/design/theme.css",
  "lib/design/theme.ts",
];
async function provenance() {
  return Object.fromEntries(
    await Promise.all(
      sources.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(project, file)))
          .digest("hex"),
      ]),
    ),
  );
}
const sourceHashes = await provenance();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PUTDUK_UI_TEST_EXECUTABLE
    ? { executablePath: process.env.PUTDUK_UI_TEST_EXECUTABLE }
    : {}),
});
const report = {
  kind: "isolated actual-component browser QA; synthetic data; not authenticated or database E2E",
  browser: browser.version(),
  sourceHashes,
  checks: [],
  screenshots: [],
};
const sections = [
  "today",
  "members",
  "events",
  "notices",
  "notifications",
  "support",
  "ledger",
  "mining",
  "audit",
  "analytics",
  "system",
];
const headings = {
  today: "오늘의 퍼뜩",
  members: "조회할 회원을 선택하세요.",
  events: "행사 운영",
  notices: "공지 운영",
  notifications: "알림 전달",
  support: "고객 지원",
  ledger: "거래 기록",
  mining: "채굴 현황",
  audit: "보안·운영 기록",
  analytics: "이용 현황",
  system: "서비스 상태",
};
try {
  for (const width of [320, 390, 834, 1440])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const section of sections) {
        await page.goto(`${origin}/?section=${section}&theme=${theme}`, {
          waitUntil: "networkidle",
        });
        await page
          .getByRole("heading", {
            name: headings[section],
            exact: true,
            level: 1,
          })
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(() =>
            document.fonts.check('16px "AdminFixture"'),
          ),
          true,
        );
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        assert(
          overflow <= 1,
          `${section}/${width}/${theme} overflow ${overflow}px`,
        );
        const nav = page.getByRole("navigation", { name: "운영자 주 메뉴" });
        const toggle = nav.getByRole("button", { name: "운영 메뉴 열기" });
        if (width <= 760) {
          assert.equal(await toggle.isVisible(), true);
          assert.equal(
            await nav.getByRole("link", { name: "공지 운영" }).isVisible(),
            false,
          );
          await toggle.click();
          assert.equal(
            await nav
              .getByRole("button", { name: "운영 메뉴 접기" })
              .getAttribute("aria-expanded"),
            "true",
          );
          await nav.getByRole("link", { name: "공지 운영" }).click();
          assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        } else assert.equal(await toggle.isVisible(), false);
        if (section === "support")
          assert.match(
            await page.locator("main").innerText(),
            /문의 접수함은 연결되어 있지/,
          );
        await page.getByText("이 화면 안내", { exact: true }).click();
        const guide = page.getByRole("region", {
          name: "운영 도우미 화면 안내",
        });
        assert.equal(await guide.isVisible(), true);
        assert(
          (await guide.evaluate(
            (node) => node.scrollWidth - node.clientWidth,
          )) <= 1,
          "screen guide must fit without sideways scrolling",
        );
        assert.match(await guide.innerText(), /실제 기록을 확인/);
        await page.keyboard.press("Escape");
        assert.equal(await guide.isVisible(), false);
        if (["today", "members", "notices", "system"].includes(section)) {
          const file = `${section}-${width}-${theme}.png`;
          await page.screenshot({
            path: path.join(output, file),
            fullPage: true,
            animations: "disabled",
          });
          report.screenshots.push(file);
        }
        report.checks.push({
          section,
          width,
          theme,
          result: "PASS",
          overflowPx: overflow,
        });
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.info(
        `Admin actual components: ${width}px ${theme} — ${sections.length} screens PASS`,
      );
    }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  for (const section of [
    "members",
    "events",
    "notices",
    "notifications",
    "ledger",
    "mining",
    "audit",
    "analytics",
    "system",
  ]) {
    await page.goto(`${origin}/?section=${section}&state=partial`, {
      waitUntil: "networkidle",
    });
    assert.match(await page.locator("main").innerText(), /확인하지 못했어요/);
    assert.doesNotMatch(
      await page.locator("main").innerText(),
      /조회된 기록이 없어요|조회된 회원이 없어요/,
    );
    await page.goto(`${origin}/?section=${section}&state=empty`, {
      waitUntil: "networkidle",
    });
    assert.match(
      await page.locator("main").innerText(),
      /조회된 (기록|회원)이 없어요/,
    );
    report.checks.push({
      section,
      result: "PASS",
      behavior: "read unavailable remains distinct from actual empty",
    });
  }
  await page.goto(`${origin}/?section=notices`, { waitUntil: "networkidle" });
  const draft = page.getByTestId("operator-writing-draft");
  assert.equal(
    await draft.getByRole("button", { name: "초안 미리보기" }).isEnabled(),
    false,
  );
  await draft.getByLabel("제목", { exact: true }).fill("합성 검증 공지");
  await draft
    .getByLabel("내용", { exact: true })
    .fill("합성 검증 내용 · 실제 게시되지 않음");
  assert.equal(
    await draft.getByRole("button", { name: "검토한 초안 복사" }).count(),
    0,
  );
  await draft.getByRole("button", { name: "초안 미리보기" }).click();
  await draft.getByRole("button", { name: "검토한 초안 복사" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="status"]')
      ?.textContent.includes("초안을 복사했어요"),
  );
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "합성 검증 공지\n\n합성 검증 내용 · 실제 게시되지 않음",
  );
  await draft
    .getByLabel("내용", { exact: true })
    .fill("수정 후 다시 검토 필요");
  assert.equal(
    await draft.getByRole("button", { name: "검토한 초안 복사" }).count(),
    0,
  );
  await context.setOffline(true);
  await page.waitForFunction(
    () => document.querySelector("textarea")?.value === "",
  );
  assert.equal(
    await draft.getByLabel("제목", { exact: true }).inputValue(),
    "",
  );
  await context.setOffline(false);
  report.checks.push({
    result: "PASS",
    behavior:
      "real browser reviewed clipboard copy, edit invalidation and offline clearing; no publish/send",
  });
  await page.goto(`${origin}/?section=events&role=CONTENT_ADMIN`, {
    waitUntil: "networkidle",
  });
  assert.equal(
    await page
      .getByRole("navigation", { name: "운영자 주 메뉴" })
      .locator('a[href="/operations/ledger"]')
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("navigation", { name: "운영자 주 메뉴" })
      .locator('a[href="/operations/notices"]')
      .count(),
    1,
  );
  await context.close();
  assert.deepEqual(
    await provenance(),
    sourceHashes,
    "Sources changed during QA",
  );
  report.result = "PASS";
} catch (error) {
  report.result = "FAIL";
  report.error = String(error);
  throw error;
} finally {
  await fs.writeFile(
    path.join(output, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await browser.close();
}
console.info(
  `Admin isolated browser QA PASS (${report.checks.length} checks). Evidence: ${output}`,
);
