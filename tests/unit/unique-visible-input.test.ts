// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import { snapshotUniqueVisibleInput } from "../e2e/authenticated/helpers/unique-visible-input";

afterEach(() => document.body.replaceChildren());

// jsdom has no layout engine or checkVisibility implementation. Keep these
// browser geometry substitutes local to each test input; no production shims.
function input({ hidden = false, visibility = "visible", width = 100 } = {}) {
  const element = document.createElement("input");
  element.id = "deposit-amount";
  element.hidden = hidden;
  element.style.visibility = visibility;
  Object.defineProperty(element, "checkVisibility", {
    value: () => !element.hidden,
  });
  element.getBoundingClientRect = () => ({ width, height: 30 }) as DOMRect;
  document.body.append(element);
  return element;
}

function snapshot() {
  return snapshotUniqueVisibleInput(
    Array.from(document.querySelectorAll("#deposit-amount")),
  );
}

test("a global duplicate remains rejected even when only one input is visible", () => {
  input();
  const retained = input({ hidden: true });
  assert.deepEqual(snapshot(), { count: 2, visible: false });
  retained.remove();
  assert.deepEqual(snapshot(), { count: 1, visible: true });
  document.body.append(retained);
  assert.deepEqual(snapshot(), { count: 2, visible: false });
});

test("missing inputs and persistent duplicate visible inputs fail closed", () => {
  assert.deepEqual(snapshot(), { count: 0, visible: false });
  input();
  input();
  assert.deepEqual(snapshot(), { count: 2, visible: false });
  assert.deepEqual(snapshot(), { count: 2, visible: false });
});

test("a unique hidden input becomes ready only after becoming visible", () => {
  const element = input({ hidden: true });
  assert.deepEqual(snapshot(), { count: 1, visible: false });
  element.hidden = false;
  assert.deepEqual(snapshot(), { count: 1, visible: true });
});

test("computed hidden visibility and zero geometry cannot pass as visible", () => {
  const element = input({ visibility: "hidden" });
  assert.deepEqual(snapshot(), { count: 1, visible: false });
  element.style.visibility = "visible";
  assert.deepEqual(snapshot(), { count: 1, visible: true });
  element.remove();
  input({ width: 0 });
  assert.deepEqual(snapshot(), { count: 1, visible: false });
});
