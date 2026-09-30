import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const origin = process.env.PUTDUK_UI_FIXTURE_URL ?? "http://127.0.0.1:4175";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const output = path.join(
  root,
  "test-results/ui-motion-remediation/component-browser",
);
await fs.mkdir(output, { recursive: true });
const resultPath = path.join(output, "results.json");
const trackedSources = [
  "app/login/auth-form.tsx",
  "app/signup/signup-form.tsx",
  "app/auth/update-password/update-password-form.tsx",
  "app/globals.css",
  "app/productization.css",
  "lib/design/theme.css",
  "lib/design/theme.ts",
  "lib/auth/signup-read-deadline.ts",
  "components/system/theme-control.tsx",
  "components/system/theme-runtime.tsx",
  "components/product/withdrawal-form.tsx",
  "components/product/product-experience.module.css",
  "components/product/guided-quest.tsx",
  "components/product/guided-quest.module.css",
  "components/foundation/mining-core.tsx",
  "components/foundation/mining-core.module.css",
  "lib/motion/ambient-runtime.ts",
  "lib/motion/motion-preference.ts",
  "apps/admin/app/globals.css",
  "apps/admin/components/mfa-gate.tsx",
  "apps/admin/components/step-up-token-field.tsx",
  "apps/admin/components/operator-fields.tsx",
  "apps/admin/lib/ui/abortable.ts",
  "apps/admin/app/(control)/kyc/review-form.tsx",
  "apps/admin/components/today/today-view.tsx",
  "apps/admin/components/today/today.module.css",
  "apps/admin/app/(control)/_lib/today-snapshot.ts",
  "tests/ui-remediation/browser/main.jsx",
  "tests/ui-remediation/browser/safety.js",
  "tests/ui-remediation/browser/admin-fixtures.jsx",
  "tests/ui-remediation/browser/web-fixtures.jsx",
  "tests/ui-remediation/browser/stubs/actions.js",
  "tests/ui-remediation/browser/stubs/admin-browser.js",
];
async function sourceManifest() {
  return Object.fromEntries(
    await Promise.all(
      trackedSources.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
}
const manifestBefore = await sourceManifest();
let manifestAfter;
const sourceManifestDigest = createHash("sha256")
  .update(JSON.stringify(manifestBefore))
  .digest("hex");
const filter = process.env.PUTDUK_COMPONENT_CASE_FILTER;
const results =
  filter && existsSync(resultPath)
    ? JSON.parse(await fs.readFile(resultPath, "utf8")).results.filter(
        (item) => !item.name.includes(filter),
      )
    : [];
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const profiles = [
  { name: "Light", preference: "light", os: "dark", resolved: "light" },
  { name: "Dark", preference: "dark", os: "light", resolved: "dark" },
  { name: "SystemLight", preference: "system", os: "light", resolved: "light" },
  { name: "SystemDark", preference: "system", os: "dark", resolved: "dark" },
];
const kinds = [
  "login",
  "signup",
  "update-password",
  "withdrawal",
  "admin-mfa",
  "admin-step-up",
  "admin-kyc",
  "admin-today",
];
const syntheticPassword = "FixturePassword123!".repeat(3);

async function save() {
  await fs.writeFile(
    resultPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseHead: "dccbfab63c5ba2fefe7f8cc689e512d326235b2e",
        manifestBefore,
        manifestAfter,
        sourceManifestDigest,
        sourceChangedDuringRun: manifestAfter
          ? JSON.stringify(manifestBefore) !== JSON.stringify(manifestAfter)
          : null,
        boundary:
          "Client-mounted actual components and actual CSS/fonts; synthetic SDK/network/server actions; no authenticated live E2E, no money/auth commands, no DB or external network. Wrapper is test-only, not production Next SSR.",
        clock:
          "Only stall/expiry scenarios fast-forward the actual browser timer after observing an in-flight operation; timer durations in app sources are unchanged.",
        textZoom:
          "200% test doubles every actual component element's resolved font-size; this checks text-only enlargement, not an OS browser zoom implementation.",
        contrast:
          "Resolved sRGB text/ancestor background samples, alpha composited. Gradients/images and ancestor opacity are explicitly unsupported; disabled contrast is recorded without an AA threshold. No blanket accessibility conformance claim.",
        passed: results.filter((item) => item.pass).length,
        failed: results.filter((item) => !item.pass).length,
        results,
      },
      null,
      2,
    ),
  );
}

async function run(name, kind, width, profile, exercise, options = {}) {
  if (filter && !name.includes(filter)) return;
  const context = await browser.newContext({
    viewport: { width, height: 960 },
    colorScheme: profile.os,
    reducedMotion: "reduce",
    locale: "ko-KR",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [],
    external = [],
    apiRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
    if (options.blockFont && url.pathname === "/fixture-font.woff2")
      return route.abort("failed");
    return route.continue();
  });
  await page.addInitScript(
    (preference) => localStorage.setItem("putduk-theme", preference),
    profile.preference,
  );
  const details = {};
  try {
    if (options.clock) await page.clock.install();
    const url = new URL(origin);
    url.searchParams.set("fixture", kind);
    if (options.sdk) url.searchParams.set("sdk", options.sdk);
    if (options.network) url.searchParams.set("network", options.network);
    if (options.phone) url.searchParams.set("phone", options.phone);
    await page.goto(url.href, { waitUntil: "load" });
    await page.waitForFunction(() => window.__PUTDUK_FIXTURE__?.ready);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      (resolved) => document.documentElement.dataset.theme === resolved,
      profile.resolved,
    );
    if (kind === "admin-mfa" && (!options.sdk || options.sdk === "ready"))
      await page.locator(".mfa-flow input").waitFor({ state: "visible" });
    if (kind === "admin-mfa" && (!options.sdk || options.sdk === "ready"))
      await page.waitForFunction(
        () => !document.querySelector(".mfa-flow input")?.disabled,
      );
    await exercise(page, details);
    details.theme = await page.evaluate(() => ({
      preference: document.documentElement.dataset.themePreference,
      resolved: document.documentElement.dataset.theme,
      colorScheme: document.documentElement.style.colorScheme,
    }));
    assert.equal(details.theme.preference, profile.preference);
    assert.equal(details.theme.resolved, profile.resolved);
    details.layout = await geometry(page);
    assert.deepEqual(
      details.layout.undersized,
      [],
      "Actual input/button click target is below 44px",
    );
    assert.deepEqual(
      details.layout.outside,
      [],
      "Actual controls exceed viewport width",
    );
    assert.deepEqual(
      details.layout.smallText,
      [],
      "Visible actual component copy is below 14px",
    );
    assert(
      details.layout.scrollWidth <= width + 1,
      "Document has horizontal overflow",
    );
    details.font = await page.evaluate(() => ({
      customLoaded: document.fonts.check('16px "PUTDUKFixturePretendard"'),
      family: getComputedStyle(
        document.querySelector("[data-fixture-kind] main"),
      ).fontFamily,
    }));
    if (options.blockFont) assert.equal(details.font.customLoaded, false);
    else assert.equal(details.font.customLoaded, true);
    details.calls = await page.evaluate(() => window.__PUTDUK_FIXTURE__.calls);
    assert.deepEqual(external, [], "External request attempted");
    assert.deepEqual(
      apiRequests,
      [],
      "Component request escaped fetch interception",
    );
    assert.deepEqual(errors, [], "Browser page error");
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
    results.push({
      name,
      kind,
      width,
      profile: profile.name,
      pass: true,
      sourceManifestDigest,
      details,
      errors,
      external,
      apiRequests,
    });
    console.info(`PASS ${name}`);
  } catch (error) {
    details.calls = await page
      .evaluate(() => window.__PUTDUK_FIXTURE__?.calls ?? [])
      .catch(() => []);
    await page
      .screenshot({
        path: path.join(output, `${name}-failure.png`),
        fullPage: true,
        animations: "disabled",
      })
      .catch(() => {});
    results.push({
      name,
      kind,
      width,
      profile: profile.name,
      pass: false,
      sourceManifestDigest,
      error: String(error),
      details,
      errors,
      external,
      apiRequests,
    });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await context.close();
    await save();
  }
}

async function geometry(page) {
  return page.locator("[data-fixture-kind]").evaluate((host) => {
    const production = (element) =>
      !element.closest(
        ".fixture-host-controls,.fixture-host-control,.fixture-style-probes",
      );
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        getComputedStyle(element).visibility !== "hidden"
      );
    };
    const controls = [
      ...host.querySelectorAll(
        "input:not([type=hidden]),select,textarea,button,a.button,a.gold-button,a.ghost-button",
      ),
    ].filter((element) => production(element) && visible(element));
    const measurements = controls.map((element) => {
      let target = element;
      if (element.matches("input[type=checkbox],input[type=radio]"))
        target = element.closest("label") ?? element;
      const rect = target.getBoundingClientRect();
      return {
        label: (
          element.getAttribute("aria-label") ||
          element.id ||
          element.name ||
          element.textContent.trim()
        ).slice(0, 90),
        type: element.tagName,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        disabled: element.disabled ?? false,
      };
    });
    const smallText = [
      ...host.querySelectorAll(
        "label,span,p,small,a,button,legend,h1,h2,h3,dt,dd,strong",
      ),
    ]
      .filter(
        (element) =>
          production(element) &&
          visible(element) &&
          element.textContent.trim() &&
          [...element.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          ),
      )
      .map((element) => ({
        text: element.textContent.trim().slice(0, 90),
        size: parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter((item) => item.size < 13.99);
    return {
      controls: measurements,
      undersized: measurements.filter(
        (item) => item.width < 43.99 || item.height < 43.99,
      ),
      outside: measurements.filter(
        (item) => item.left < -1 || item.right > innerWidth + 1,
      ),
      smallText,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
    };
  });
}

async function focusEvidence(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.keyboard.press("Tab");
  await locator.focus();
  await page.waitForFunction(
    (element) => {
      const css = getComputedStyle(element);
      const visibleOutline =
        css.outlineStyle !== "none" &&
        css.outlineStyle !== "hidden" &&
        parseFloat(css.outlineWidth) > 0;
      const colors = css.boxShadow.match(/rgba?\([^)]*\)/g) ?? [];
      const visibleShadow = colors.some(
        (color) =>
          !color.startsWith("rgba") ||
          Number(color.slice(color.lastIndexOf(",") + 1, -1)) > 0,
      );
      return (
        element.matches(":focus-visible") && (visibleOutline || visibleShadow)
      );
    },
    await locator.elementHandle(),
  );
  const result = await locator.evaluate((element) => {
    const css = getComputedStyle(element),
      rect = element.getBoundingClientRect();
    return {
      focusVisible: element.matches(":focus-visible"),
      outlineWidth: css.outlineWidth,
      outlineStyle: css.outlineStyle,
      outlineColor: css.outlineColor,
      boxShadow: css.boxShadow,
      outlineVisible:
        css.outlineStyle !== "none" &&
        css.outlineStyle !== "hidden" &&
        parseFloat(css.outlineWidth) > 0,
      visible:
        rect.top >= 0 &&
        rect.bottom <= innerHeight &&
        rect.left >= 0 &&
        rect.right <= innerWidth,
    };
  });
  assert(
    result.focusVisible &&
      (result.outlineVisible || result.boxShadow !== "none"),
    "Keyboard focus indicator missing",
  );
  assert(result.visible, "Focused control not fully visible");
  return result;
}

async function contrast(page, locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    function color(css) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((value, index) =>
        index === 3 ? value / 255 : value / 255,
      );
    }
    function over(top, bottom) {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      return [0, 1, 2]
        .map((index) =>
          alpha
            ? (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) /
              alpha
            : 0,
        )
        .concat(alpha);
    }
    function background(start) {
      let composite = [0, 0, 0, 0];
      const unsupported = [];
      for (
        let current = start;
        current && composite[3] < 0.999;
        current = current.parentElement
      ) {
        const css = getComputedStyle(current);
        if (css.backgroundImage !== "none")
          unsupported.push("background-image");
        if (Number(css.opacity) !== 1) unsupported.push("ancestor-opacity");
        composite = over(composite, color(css.backgroundColor));
      }
      return { rgba: over(composite, [1, 1, 1, 1]), unsupported };
    }
    function luminance(rgb) {
      return rgb
        .slice(0, 3)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    }
    function ratio(a, b) {
      const aa = luminance(a),
        bb = luminance(b);
      return (Math.max(aa, bb) + 0.05) / (Math.min(aa, bb) + 0.05);
    }
    const css = getComputedStyle(element),
      inside = background(element),
      outside = background(element.parentElement);
    // Translucent borders normally paint over the element's own border-box background.
    const borderBackground =
      css.backgroundClip.split(",").at(-1).trim() === "border-box"
        ? inside
        : outside;
    const foreground = over(color(css.color), inside.rgba),
      border = over(color(css.borderTopColor), borderBackground.rgba),
      outline = over(color(css.outlineColor), outside.rgba);
    return {
      text: element.textContent.trim().slice(0, 70),
      color: css.color,
      background: css.backgroundColor,
      composedBackground: inside.rgba,
      textContrast: ratio(foreground, inside.rgba),
      textUnsupported: [...new Set(inside.unsupported)],
      border: css.borderTopColor,
      borderMethod: "resolved-background-clip",
      backgroundClip: css.backgroundClip,
      borderComposedRgba: border,
      borderStyle: css.borderTopStyle,
      borderWidth: css.borderTopWidth,
      borderContrastOuter: ratio(border, outside.rgba),
      borderContrastInner: ratio(border, inside.rgba),
      outline: css.outlineColor,
      outlineStyle: css.outlineStyle,
      outlineWidth: css.outlineWidth,
      focusVisible: element.matches(":focus-visible"),
      boxShadow: css.boxShadow,
      shadowColors: (css.boxShadow.match(/rgba?\([^)]*\)/g) ?? []).map(
        (shadowColor) => ({
          color: shadowColor,
          composedRgba: over(color(shadowColor), outside.rgba),
          outerContrast: ratio(
            over(color(shadowColor), outside.rgba),
            outside.rgba,
          ),
          unsupported: outside.unsupported,
        }),
      ),
      outlineContrast: ratio(outline, outside.rgba),
      unsupported: [
        ...new Set([...inside.unsupported, ...outside.unsupported]),
      ],
      disabled: element.disabled ?? false,
      fontSize: css.fontSize,
      fontWeight: css.fontWeight,
    };
  });
}

async function contrastStates(page, selector) {
  const locator = page.locator(selector).first();
  if (!(await locator.count())) return null;
  await page.mouse.move(0, 0);
  await locator.evaluate((element) => element.blur());
  const normal = await contrast(page, locator);
  await locator.hover();
  await page.waitForTimeout(250);
  const hover = await contrast(page, locator);
  await page.mouse.move(0, 0);
  if (await locator.isEnabled()) await focusEvidence(page, locator);
  await page.waitForTimeout(250);
  const focus = await contrast(page, locator);
  for (const sample of [normal, hover, focus]) {
    if (!sample.disabled && sample.textUnsupported.length === 0) {
      const large =
        parseFloat(sample.fontSize) >= 24 ||
        (parseFloat(sample.fontSize) >= 18.6667 &&
          Number(sample.fontWeight) >= 700);
      assert(
        sample.textContrast >= (large ? 3 : 4.5),
        `Resolved text contrast below threshold: ${selector} ${sample.textContrast}`,
      );
    }
  }
  return { normal, hover, focus };
}

async function reveal(page, id, value) {
  const input = page.locator(`#${id}`);
  await input.fill(value);
  const button = page.locator(`button[aria-controls~="${id}"]`);
  await button.click();
  assert.equal(await input.getAttribute("type"), "text");
  assert.equal(await input.inputValue(), value);
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  const layout = await button.evaluate((element) => {
    const input = document.getElementById(
        element.getAttribute("aria-controls").split(" ")[0],
      ),
      a = input.getBoundingClientRect(),
      b = element.getBoundingClientRect(),
      css = getComputedStyle(input);
    return {
      input: a.toJSON(),
      button: b.toJSON(),
      paddingRight: parseFloat(css.paddingRight),
      labelParent: Boolean(element.closest("label")),
      centerDelta: Math.abs(a.top + a.height / 2 - b.top - b.height / 2),
      reserve: a.right - b.left,
    };
  });
  assert(!layout.labelParent, "Reveal button nested inside field label");
  assert(layout.centerDelta <= 1.1, "Reveal button is not vertically centered");
  assert(
    layout.paddingRight >= layout.reserve - 1,
    "Input text can occupy reveal button area",
  );
  await button.click();
  assert.equal(await input.getAttribute("type"), "password");
  assert.equal(await input.inputValue(), value);
  return layout;
}

async function exerciseBase(page, details, kind) {
  if (kind === "login") {
    await page
      .locator("#login-identifier")
      .fill("fixture_account@invalid.example");
    details.reveal = await reveal(page, "login-password", syntheticPassword);
    details.focus = await focusEvidence(page, page.locator("#login-password"));
    details.primary = await contrastStates(page, ".auth-form .button--primary");
    details.secondary = await contrastStates(
      page,
      ".auth-form .button--secondary",
    );
    details.field = await contrast(page, page.locator("#login-password"));
  } else if (kind === "signup") {
    details.reveal = await reveal(page, "signup-password", syntheticPassword);
    details.confirmReveal = await reveal(
      page,
      "signup-password-confirmation",
      syntheticPassword,
    );
    const alignment = await page
      .locator("#signup-password")
      .evaluate((element) => {
        const a = element.getBoundingClientRect(),
          b = document
            .getElementById("signup-password-confirmation")
            .getBoundingClientRect();
        return {
          first: a.toJSON(),
          confirmation: b.toJSON(),
          sameRow: Math.abs(a.left - b.left) > 1,
        };
      });
    if (alignment.sameRow)
      assert(Math.abs(alignment.first.top - alignment.confirmation.top) <= 1);
    assert(
      Math.abs(alignment.first.height - alignment.confirmation.height) <= 1,
    );
    details.alignment = alignment;
    await page.locator("#signup-date-of-birth").fill("2000-02-03");
    assert(
      (
        await page
          .locator("#signup-date-of-birth")
          .getAttribute("aria-describedby")
      ).includes("date-of-birth-help"),
    );
    assert(
      (await page.locator("#date-of-birth-help").innerText()).includes(
        "연도, 월, 일",
      ),
      "DOB has locale-independent Korean year/month/day guidance",
    );
    await page
      .locator("#signup-password-confirmation")
      .fill("MismatchFixture123!");
    assert.equal(
      await page
        .locator("#signup-password-confirmation")
        .getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(
      await page
        .locator("#signup-password-confirmation-help")
        .getAttribute("role"),
      "alert",
    );
    await page.locator("#signup-password-confirmation").fill(syntheticPassword);
    details.focus = await focusEvidence(
      page,
      page.locator("#signup-password-confirmation"),
    );
    details.primary = await contrastStates(
      page,
      ".signup-form .button--primary",
    );
    details.field = await contrast(page, page.locator("#signup-password"));
  } else if (kind === "update-password") {
    await page.locator("#password-confirmation").fill(syntheticPassword);
    details.reveal = await reveal(page, "new-password", syntheticPassword);
    assert.equal(
      await page.locator("#password-confirmation").inputValue(),
      syntheticPassword,
    );
    await page.locator("#password-confirmation").fill("MismatchFixture123!");
    assert(await page.locator("button[type=submit]").isDisabled());
    details.disabledSubmit = await contrast(
      page,
      page.locator("button[type=submit]"),
    );
    assert(await page.locator("#password-mismatch").isVisible());
    await page.locator("#password-confirmation").fill(syntheticPassword);
    details.focus = await focusEvidence(page, page.locator("#new-password"));
    details.primary = await contrastStates(page, ".auth-form .button--primary");
    details.field = await contrast(page, page.locator("#new-password"));
  } else if (kind === "withdrawal") {
    await page.getByRole("button", { name: "5천원", exact: true }).click();
    assert.equal(await page.locator("#withdrawal-amount").inputValue(), "5000");
    await page.locator('[name="bankCode"]').selectOption("KB");
    await page.locator('[name="accountHolder"]').fill("합성테스트사용자");
    await page.locator('[name="accountNumber"]').fill("000000000000");
    details.focus = await focusEvidence(
      page,
      page.locator("#withdrawal-amount"),
    );
    details.primary = await contrastStates(
      page,
      '[data-fixture-kind] button[type="submit"]',
    );
    details.field = await contrast(page, page.locator("#withdrawal-amount"));
    await page.locator('input[value="USDT_ADDRESS"]').check();
    await page.locator('[name="network"]').selectOption("TRC20");
    const address = "FixtureAddressNeverUsedForTransfers000000000000";
    await page.locator('[name="address"]').fill(address);
    const addressInput = page.locator('[name="address"]');
    const addressId = await addressInput.getAttribute("id");
    assert(addressId, "Address has a stable label/control id");
    const addressButton = page.locator(`button[aria-controls="${addressId}"]`);
    assert.equal(await addressButton.getAttribute("aria-pressed"), "false");
    assert.equal(
      await addressButton.evaluate(
        (button) => button.closest("label") !== null,
      ),
      false,
    );
    assert.equal(
      await addressInput.evaluate((input) =>
        input.labels?.[0]?.textContent.trim(),
      ),
      "받을 주소",
    );
    await addressButton.click();
    assert.equal(
      await page.locator('[name="address"]').getAttribute("type"),
      "text",
    );
    assert.equal(await page.locator('[name="address"]').inputValue(), address);
    assert.equal(await addressButton.getAttribute("aria-pressed"), "true");
    await addressButton.click();
    assert.equal(await addressButton.getAttribute("aria-pressed"), "false");
    details.addressRevealSemantics = {
      id: addressId,
      label: "받을 주소",
      controlsLinked: true,
      pressedTransitions: [false, true, false],
      separateFromLabel: true,
    };
    assert.equal(
      await page.locator('[name="address"]').getAttribute("type"),
      "password",
    );
  } else if (kind === "admin-today") {
    details.evidenceHelperRoleProbe = await page.evaluate(() => {
      const list = document.createElement("ul");
      list.className = "evidence-list";
      const item = document.createElement("li");
      const helper = document.createElement("small");
      helper.textContent = "기록 번호 표기 검사";
      item.append(helper);
      list.append(item);
      document.body.append(list);
      const result = {
        fontSize: parseFloat(getComputedStyle(helper).fontSize),
        basis:
          "Temporary CSS role probe matching the member evidence-list small markup; not a populated or authenticated member page",
      };
      list.remove();
      return result;
    });
    assert(
      details.evidenceHelperRoleProbe.fontSize >= 14,
      "Native member evidence helper is undersized",
    );
    assert.equal(
      await page.getByTestId("today-attention-total").innerText(),
      "14",
    );
    const select = page.getByLabel("합성 대기열 상태");
    await select.selectOption("partial");
    assert.equal(
      await page.getByTestId("today-attention-total").innerText(),
      "확인 필요",
    );
    assert(await page.getByTestId("today-partial-failure").isVisible());
    assert.equal(
      await page
        .getByTestId("today-queue-KYC")
        .getAttribute("data-count-state"),
      "unavailable",
    );
    await select.selectOption("empty");
    assert.equal(
      await page.getByTestId("today-attention-total").innerText(),
      "0",
    );
    assert(await page.getByTestId("today-empty-queues").isVisible());
    assert(await page.getByTestId("today-audit-empty").isVisible());
    await select.selectOption("populated");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="today-attention-total"]')
          ?.textContent === "14" &&
        document
          .querySelector('[data-testid="today-queue-KYC"]')
          ?.getAttribute("data-count-state") === "ready",
    );
    details.focus = await focusEvidence(
      page,
      page.getByTestId("today-queue-KYC"),
    );
  } else {
    const input = page.locator(
      kind === "admin-mfa"
        ? ".mfa-flow input"
        : ".operator-step-up input:not([type=hidden])",
    );
    await input.fill("123456");
    details.focus = await focusEvidence(page, input);
    details.field = await contrast(page, input);
    if (kind === "admin-kyc")
      await page
        .locator('[name="reason"]')
        .fill("합성 검증용 사유입니다. 실제 심사를 실행하지 않습니다.");
  }
  if (kind.startsWith("admin-")) {
    details.gold = await contrastStates(
      page,
      ".fixture-style-probes .gold-button",
    );
    details.danger = await contrastStates(
      page,
      ".fixture-style-probes .danger-button",
    );
    details.errorText = await contrast(
      page,
      page.locator(".fixture-style-probes .form-error"),
    );
    details.warningText = await contrast(
      page,
      page.locator(".fixture-style-probes .warn-note"),
    );
    for (const sample of [details.errorText, details.warningText])
      if (!sample.textUnsupported.length)
        assert(
          sample.textContrast >= 4.5,
          `Admin status text contrast ${sample.textContrast}`,
        );
  }
}

async function issue(page) {
  await page
    .locator(".operator-step-up input:not([type=hidden])")
    .fill("123456");
  await page.locator(".operator-step-up button").click();
}
async function tokenIs(page, present) {
  await page.waitForFunction(
    (present) =>
      Boolean(document.querySelector('input[name="stepUpToken"]')?.value) ===
      present,
    present,
  );
}
async function idleStep(page) {
  await page.waitForFunction(
    () => !document.querySelector(".operator-step-up button")?.disabled,
  );
}

try {
  for (const kind of [
    "login",
    "signup",
    "withdrawal",
    "admin-mfa",
    "admin-kyc",
    "admin-today",
  ])
    for (const profile of [profiles[0], profiles[1]])
      await run(
        `contrast-paired-${kind}-${profile.name}`,
        kind,
        390,
        profile,
        async (page, details) => {
          await exerciseBase(page, details, kind);
          const fieldSelector = {
            login: "#login-password",
            signup: "#signup-password",
            withdrawal: '[name="network"]',
            "admin-mfa": ".mfa-flow input",
            "admin-kyc": ".operator-step-up input:not([type=hidden])",
          }[kind];
          if (fieldSelector) {
            details.pairedField = await contrast(
              page,
              page.locator(fieldSelector),
            );
            if (
              details.pairedField.borderStyle !== "none" &&
              !details.pairedField.textUnsupported.length
            )
              assert(
                details.pairedField.borderContrastInner >= 3,
                `Actual field border contrast below3: ${details.pairedField.borderContrastInner}`,
              );
            const field = page.locator(fieldSelector);
            await field.hover();
            await page.waitForTimeout(250);
            details.pairedFieldHover = await contrast(page, field);
            await page.mouse.move(0, 0);
            details.pairedFieldFocusIndicator = await focusEvidence(
              page,
              field,
            );
            await page.waitForTimeout(250);
            details.pairedFieldFocus = await contrast(page, field);
            for (const sample of [
              details.pairedFieldHover,
              details.pairedFieldFocus,
            ])
              if (
                sample.borderStyle !== "none" &&
                !sample.textUnsupported.length
              )
                assert(
                  sample.borderContrastInner >= 3,
                  `Actual state field border contrast below3: ${sample.borderContrastInner}`,
                );
          }
          details.pairedBorderMethod =
            "Alpha composited over the resolved background-clip; inactive outline styles are explicitly recorded, actual focus shadow colors retained.";
        },
      );
  for (const kind of kinds)
    for (const width of [390, 834, 1440])
      for (const profile of profiles) {
        await run(
          `${kind}-${width}-${profile.name}`,
          kind,
          width,
          profile,
          (page, details) => exerciseBase(page, details, kind),
        );
      }

  for (const kind of ["login", "signup", "update-password"])
    await run(
      `auth-blocked-action-${kind}`,
      kind,
      390,
      profiles[0],
      async (page, details) => {
        await exerciseBase(page, details, kind);
        if (kind === "signup") {
          await page.locator("#signup-legal-name").fill("합성테스트");
          await page.locator("#signup-phone").fill("01012345678");
          await page
            .locator("#signup-recovery-email")
            .fill("fixture@invalid.example");
          await page.locator("#signup-login-id").fill("fixture_user");
          await page.locator("#consent-service").check();
          await page.locator("#consent-privacy").check();
        }
        await page.locator("[data-fixture-kind] button[type=submit]").click();
        await page
          .locator("[data-fixture-kind] form[data-ui-state=error]")
          .waitFor();
        assert(
          await page.locator("[data-fixture-kind] [role=alert]").isVisible(),
        );
        assert(
          await page
            .locator("[data-fixture-kind] button[type=submit]")
            .isEnabled(),
        );
        details.actualErrorUiFromBlockedAction = true;
      },
    );

  for (const mode of ["throw", "malformed", "stall", "json-stall"])
    await run(
      `signup-id-availability-${mode}`,
      "signup",
      390,
      profiles[0],
      async (page, details) => {
        await page.locator("#signup-login-id").fill("fixture_user");
        const button = page
          .locator("#signup-login-id")
          .locator("..")
          .locator("button");
        await button.click();
        if (mode === "stall" || mode === "json-stall") {
          await page.waitForFunction(() =>
            window.__PUTDUK_FIXTURE__.calls.some((call) =>
              call.operation.includes("login-id-availability"),
            ),
          );
          await page.clock.fastForward(16000);
        }
        await page.waitForFunction(
          () =>
            !document
              .querySelector("#signup-login-id")
              ?.parentElement.querySelector("button")?.disabled,
        );
        assert(
          (await page.locator("#login-id-status").innerText()).includes(
            "못했어요",
          ),
        );
        assert.equal(
          await page.locator("#signup-login-id").inputValue(),
          "fixture_user",
        );
        details.readFailurePreservesInputAndReleasesCheck = true;
      },
      { network: mode, clock: mode === "stall" || mode === "json-stall" },
    );

  for (const mode of ["throw", "stall"])
    await run(
      `signup-phone-availability-${mode}`,
      "signup",
      390,
      profiles[1],
      async (page, details) => {
        await page.locator("#signup-phone").fill("01012345678");
        const button = page
          .locator("#signup-phone")
          .locator("..")
          .locator("button");
        await button.click();
        if (mode === "stall") {
          await page.waitForFunction(() =>
            window.__PUTDUK_FIXTURE__.calls.some((call) =>
              call.operation.includes("phone-availability"),
            ),
          );
          await page.clock.fastForward(16000);
        }
        await page.waitForFunction(
          () =>
            !document
              .querySelector("#signup-phone")
              ?.parentElement.querySelector("button")?.disabled,
        );
        assert(
          (await page.locator("#phone-status").innerText()).includes(
            "못했어요",
          ),
        );
        assert.equal(
          await page.locator("#signup-phone").inputValue(),
          "01012345678",
        );
        details.readFailurePreservesInputAndReleasesCheck = true;
      },
      { phone: mode, clock: mode === "stall" },
    );

  for (const mode of ["throw", "stall"])
    await run(
      `mfa-sdk-${mode}`,
      "admin-mfa",
      390,
      profiles[0],
      async (page, details) => {
        if (mode === "stall") {
          await page.waitForFunction(() =>
            window.__PUTDUK_FIXTURE__.calls.some(
              (call) => call.operation === "sdk:getSession",
            ),
          );
          await page.clock.fastForward(16000);
        }
        await page
          .getByRole("button", { name: "다시 확인", exact: true })
          .waitFor();
        assert(await page.locator(".mfa-flow input").isDisabled());
        await page.getByLabel("로컬 SDK 응답").selectOption("ready");
        await page.waitForFunction(
          () => !document.querySelector(".mfa-flow input")?.disabled,
        );
        details.recovered = true;
      },
      { sdk: mode, clock: mode === "stall" },
    );

  for (const mode of ["throw", "malformed", "stall", "json-stall"])
    await run(
      `mfa-network-${mode}`,
      "admin-mfa",
      390,
      profiles[1],
      async (page, details) => {
        await page.locator(".mfa-flow input").fill("123456");
        await page.locator(".mfa-flow button[type=submit]").click();
        if (mode === "stall" || mode === "json-stall") {
          await page.waitForFunction(() =>
            window.__PUTDUK_FIXTURE__.calls.some((call) =>
              call.operation.startsWith("fetch:"),
            ),
          );
          await page.clock.fastForward(16000);
        }
        await page.waitForFunction(
          () =>
            !document.querySelector(".mfa-flow button[type=submit]")?.disabled,
        );
        assert(
          (await page.locator(".mfa-flow .form-note").innerText()).includes(
            "못했습니다",
          ),
        );
        assert(
          !(await page.evaluate(() => window.__PUTDUK_FIXTURE__.calls)).some(
            (call) => call.operation.startsWith("router:replace"),
          ),
        );
        details.busyReleased = true;
      },
      { network: mode, clock: mode === "stall" || mode === "json-stall" },
    );

  await run(
    "mfa-success-contract",
    "admin-mfa",
    390,
    profiles[0],
    async (page, details) => {
      await page.locator(".mfa-flow input").fill("123456");
      await page.locator(".mfa-flow button[type=submit]").click();
      await page.waitForFunction(() =>
        window.__PUTDUK_FIXTURE__.calls.some((call) =>
          call.operation.startsWith("router:replace"),
        ),
      );
      details.validSyntheticUuid = true;
    },
    { network: "success" },
  );

  for (const axis of ["sdk", "network"])
    for (const mode of axis === "sdk"
      ? ["throw", "stall"]
      : ["throw", "malformed", "stall", "json-stall", "wrong-family"])
      await run(
        `stepup-${axis}-${mode}`,
        "admin-step-up",
        390,
        profiles[1],
        async (page, details) => {
          await issue(page);
          if (mode === "stall" || mode === "json-stall") {
            await page.waitForFunction(
              () =>
                document.querySelector(".operator-step-up button")?.disabled,
            );
            await page.clock.fastForward(16000);
          }
          await idleStep(page);
          await tokenIs(page, false);
          details.busyReleased = true;
          await page
            .getByLabel(axis === "sdk" ? "로컬 SDK 응답" : "로컬 요청 응답")
            .selectOption(axis === "sdk" ? "ready" : "success");
          await page.evaluate(() => {
            window.__PUTDUK_FIXTURE__.networkMode = "success";
          });
          await issue(page);
          await tokenIs(page, true);
          details.recovered = true;
        },
        { [axis]: mode, clock: mode === "stall" || mode === "json-stall" },
      );

  await run(
    "stepup-stale-token-invalidation",
    "admin-step-up",
    390,
    profiles[0],
    async (page, details) => {
      await issue(page);
      await tokenIs(page, true);
      await page
        .locator(".operator-step-up input:not([type=hidden])")
        .fill("1");
      await tokenIs(page, false);
      await page.locator(".operator-step-up button").click();
      await tokenIs(page, false);
      await issue(page);
      await tokenIs(page, true);
      await page
        .getByLabel("합성 작업 종류")
        .selectOption("WITHDRAWAL_OPERATOR");
      await tokenIs(page, false);
      await issue(page);
      await tokenIs(page, true);
      await page.evaluate(() => dispatchEvent(new Event("offline")));
      await tokenIs(page, false);
      await issue(page);
      await tokenIs(page, true);
      await page.evaluate(() =>
        window.__PUTDUK_FIXTURE__.emitAuth("SIGNED_OUT"),
      );
      await tokenIs(page, false);
      await issue(page);
      await tokenIs(page, true);
      await page.getByLabel("합성 부모 작업 진행 중").check();
      await tokenIs(page, false);
      assert(await page.locator(".operator-step-up button").isDisabled());
      await page.getByLabel("합성 부모 작업 진행 중").uncheck();
      await issue(page);
      await tokenIs(page, true);
      await page.clock.fastForward(300001);
      await tokenIs(page, false);
      details.invalidations = [
        "input-change",
        "invalid-code",
        "command-family",
        "offline",
        "signed-out",
        "parent-pending",
        "five-minute-client-expiry",
      ];
    },
    { network: "success", clock: true },
  );

  await run(
    "kyc-evidence-failure-blocks-decision",
    "admin-kyc",
    390,
    profiles[1],
    async (page, details) => {
      const form = page.getByRole("form", { name: "본인 확인 검토" });
      await page.getByLabel("합성 제출 자료 확인 가능").uncheck();
      assert(await form.locator("[name=decision]").isDisabled());
      assert(await form.locator("button[type=submit]").isDisabled());
      await form.evaluate((element) => element.requestSubmit());
      assert(
        !(await page.evaluate(() => window.__PUTDUK_FIXTURE__.calls)).some(
          (call) => call.operation === "action:kyc-review-blocked",
        ),
      );
      await page.getByLabel("합성 제출 자료 확인 가능").check();
      await form.locator("[name=decision]").selectOption("APPROVED");
      await form
        .locator("[name=reason]")
        .fill("합성 테스트의 제출 차단을 검증하는 사유입니다.");
      await form.locator("[name=confirmation]").check();
      await issue(page);
      await tokenIs(page, true);
      await page.evaluate(() => {
        window.__PUTDUK_FIXTURE__.actionDelayMs = 1000;
      });
      await form.locator("button[type=submit]").click();
      await page.waitForFunction(
        () => document.querySelector(".operator-form fieldset")?.disabled,
      );
      await tokenIs(page, false);
      await page.clock.fastForward(1001);
      await page.waitForFunction(
        () => !document.querySelector(".operator-form fieldset")?.disabled,
      );
      assert(
        (await form.innerText()).includes(
          "로컬 테스트에서는 심사 결과를 저장하지 않습니다.",
        ),
      );
      assert.equal(
        await form.locator("[name=reason]").inputValue(),
        "합성 테스트의 제출 차단을 검증하는 사유입니다.",
      );
      details.commandBlockedAndTokenCleared = true;
    },
    { network: "success", clock: true },
  );

  for (const kind of [
    "login",
    "signup",
    "update-password",
    "withdrawal",
    "admin-kyc",
    "admin-today",
  ])
    for (const profile of [profiles[0], profiles[1]])
      await run(
        `text200-${kind}-390-${profile.name}`,
        kind,
        390,
        profile,
        async (page, details) => {
          await exerciseBase(page, details, kind);
          await page.locator("[data-fixture-kind]").evaluate((host) => {
            const elements = [host, ...host.querySelectorAll("*")];
            const sizes = elements.map((element) =>
              parseFloat(getComputedStyle(element).fontSize),
            );
            elements.forEach((element, index) => {
              element.style.fontSize = `${sizes[index] * 2}px`;
            });
          });
          if (kind === "signup")
            await page
              .locator("#signup-legal-name")
              .fill("아주긴합성테스트사용자이름".repeat(4));
          if (kind === "withdrawal")
            await page
              .locator('[name="address"]')
              .fill("SyntheticLongAddressNoNetwork".repeat(4));
          const passwordId = {
            login: "login-password",
            signup: "signup-password",
            "update-password": "new-password",
          }[kind];
          if (passwordId)
            details.enlargedReveal = await reveal(
              page,
              passwordId,
              syntheticPassword,
            );
          details.textOnly200Percent = true;
        },
      );

  for (const kind of ["login", "admin-kyc"])
    await run(
      `font-blocked-${kind}-390`,
      kind,
      390,
      profiles[0],
      async (page, details) => {
        await exerciseBase(page, details, kind);
        details.localFontBlocked = true;
      },
      { blockFont: true },
    );

  await run(
    "system-preference-live-transition",
    "login",
    390,
    profiles[2],
    async (page, details) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "light",
      );
      await page.getByLabel("화면 테마", { exact: true }).selectOption("dark");
      await page.emulateMedia({ colorScheme: "light" });
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.theme),
        "dark",
      );
      await page
        .getByLabel("화면 테마", { exact: true })
        .selectOption("system");
      details.transitions = [
        "system-light",
        "system-dark",
        "system-light",
        "explicit-dark-survives-os-light",
        "system-restored",
      ];
    },
  );
} finally {
  await browser.close();
  manifestAfter = await sourceManifest();
  await save();
}
assert.deepEqual(
  manifestAfter,
  manifestBefore,
  "Tracked source changed during browser evidence",
);
const failed = results.filter((item) => !item.pass);
console.info(
  `COMPONENT RESULTS ${results.length - failed.length}/${results.length} passed; browser closed`,
);
if (failed.length) process.exitCode = 1;
