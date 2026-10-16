// @vitest-environment jsdom
import assert from "node:assert/strict";

import { test } from "vitest";

import { startDepositDomDiagnostics } from "../e2e/authenticated/helpers/deposit-dom-diagnostics";

function fixture() {
  document.body.replaceChildren();
  const dispose = startDepositDomDiagnostics()!;
  return { document, diagnostics: window.__putdukDepositDiagnostics!, dispose };
}

test("records duplicate transitions and hidden ancestors without exposing DOM data", async () => {
  const { document, diagnostics, dispose } = fixture();
  try {
    document.body.innerHTML =
      '<main data-ui-ready="/wallet/deposit"><input id="deposit-amount" value="PRIVATE_AMOUNT"></main>';
    diagnostics.mark("reload-ready");
    const hidden = document.createElement("div");
    hidden.id = "S:PRIVATE_STREAM";
    hidden.hidden = true;
    hidden.setAttribute("inert", "");
    hidden.setAttribute("aria-hidden", "true");
    hidden.style.display = "none";
    hidden.innerHTML =
      '<main data-ui-ready="/wallet/deposit"><input id="deposit-amount" value="PRIVATE_AMOUNT"></main>PRIVATE_TEXT';
    document.body.append(hidden);
    await Promise.resolve();
    const duplicate = diagnostics.read().records.at(-1)!;
    assert.ok(duplicate, "observer must retain the duplicate transition");
    assert.equal(duplicate.source, "mutation");
    assert.equal(duplicate.amountCount, 2);
    assert.equal(duplicate.routeCount, 2);
    assert.equal(duplicate.mainCount, 2);
    assert.deepEqual(Array.from(duplicate.nodes[1]!.reasons), [
      "react-stream",
      "hidden",
      "inert",
      "aria-hidden",
      "display-none",
    ]);
    hidden.remove();
    await Promise.resolve();
    assert.equal(diagnostics.read().records.at(-1)!.amountCount, 1);
    assert.doesNotMatch(
      JSON.stringify(diagnostics.read()),
      /PRIVATE|deposit-amount|<input/,
    );
    assert.equal(document.querySelector("input")!.value, "PRIVATE_AMOUNT");
  } finally {
    dispose();
    document.body.replaceChildren();
  }
});

test("bounds observations while retaining the latest failure and ignores irrelevant mutations", async () => {
  const { document, diagnostics, dispose } = fixture();
  try {
    document.body.innerHTML = '<input id="deposit-amount">';
    diagnostics.mark("method-before");
    const count = diagnostics.read().records.length;
    document.querySelector("input")!.setAttribute("class", "PRIVATE_CLASS");
    await Promise.resolve();
    assert.equal(diagnostics.read().records.length, count);
    for (let index = 0; index < 24; index++) {
      document.querySelector("input")!.toggleAttribute("hidden");
      await Promise.resolve();
    }
    diagnostics.mark("failure");
    const report = diagnostics.read();
    assert.equal(report.records.length, 16);
    assert.ok(report.dropped > 0);
    assert.equal(report.records.at(-1)!.phase, "failure");
    assert.equal(report.records.at(-1)!.source, "mark");
  } finally {
    dispose();
    document.body.replaceChildren();
  }
});

test("timestamps lifecycle records in relative monotonic milliseconds without adding private data", async () => {
  const { document, diagnostics, dispose } = fixture();
  try {
    document.body.innerHTML =
      '<input id="deposit-amount" value="PRIVATE_TIMING">';
    diagnostics.mark("reload-ready");
    const ready = diagnostics.read().records.at(-1)!;
    assert.ok(Number.isInteger(ready.elapsedMs));
    assert.ok(ready.elapsedMs >= 0);
    await new Promise((resolve) => setTimeout(resolve, 15));
    diagnostics.mark("method-before");
    diagnostics.mark("method-after");
    diagnostics.mark("failure");
    const records = diagnostics.read().records;
    assert.ok(records.at(-1)!.elapsedMs - ready.elapsedMs >= 5);
    for (let index = 1; index < records.length; index++) {
      assert.ok(records[index]!.elapsedMs >= records[index - 1]!.elapsedMs);
    }
    assert.doesNotMatch(
      JSON.stringify(diagnostics.read()),
      /PRIVATE|deposit-amount|<input|timeOrigin|timestamp/,
    );
  } finally {
    dispose();
    document.body.replaceChildren();
  }
});
