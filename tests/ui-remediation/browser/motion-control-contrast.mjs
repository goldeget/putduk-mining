import assert from "node:assert/strict";

export async function readMotionControlContrast(locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    function color(value) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map(
        (channel) => channel / 255,
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
    function luminance(value) {
      return value
        .slice(0, 3)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (total, channel, index) =>
            total + channel * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    }
    function ratio(a, b) {
      const first = luminance(a),
        second = luminance(b);
      return (
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      );
    }
    const css = getComputedStyle(element);
    const background = color(css.backgroundColor);
    const borderClip = css.backgroundClip.split(",").at(-1).trim();
    const unsupported = [];
    // These controls supply an opaque interior. This deliberately avoids
    // treating the Home picture or a stage pseudo-gradient as a flat backdrop.
    if (background[3] < 0.999) unsupported.push("translucent-interior");
    if (css.backgroundImage !== "none") unsupported.push("interior-image");
    for (let current = element; current; current = current.parentElement) {
      if (Number(getComputedStyle(current).opacity) !== 1)
        unsupported.push("ancestor-opacity");
    }
    if (borderClip !== "border-box") unsupported.push("non-border-box");
    return {
      label: element.textContent.trim(),
      textContrast: ratio(over(color(css.color), background), background),
      borderContrastInner: ratio(
        over(color(css.borderTopColor), background),
        background,
      ),
      border: css.borderTopColor,
      background: css.backgroundColor,
      backgroundClip: css.backgroundClip,
      borderStyle: css.borderTopStyle,
      disabled: element.disabled,
      unsupported: [...new Set(unsupported)],
      evidenceBoundary:
        "Opaque control interior and border-box composition only; outside images/pseudo-gradients are not measured",
    };
  });
}

export function assertMotionControlContrast(sample) {
  assert.deepEqual(sample.unsupported, [], "Unsupported control interior");
  // Disabled controls are reported without imposing an active-control threshold.
  if (sample.disabled) return;
  assert(
    sample.textContrast >= 4.5,
    `Control text ratio${sample.textContrast}`,
  );
  assert(
    sample.borderStyle !== "none" && sample.borderContrastInner >= 3,
    `Control border-box inner ratio${sample.borderContrastInner}`,
  );
}

export async function readMotionControlStates(page, locator) {
  await page.mouse.move(0, 0);
  const normal = await readMotionControlContrast(locator);
  await locator.hover();
  await page.waitForTimeout(250);
  const hover = await readMotionControlContrast(locator);
  await page.mouse.move(0, 0);
  let focus = null;
  if (await locator.isEnabled()) {
    await page.keyboard.press("Tab");
    await locator.focus();
    focus = await readMotionControlContrast(locator);
  }
  for (const sample of [normal, hover, focus].filter(Boolean))
    assertMotionControlContrast(sample);
  return { normal, hover, focus };
}
