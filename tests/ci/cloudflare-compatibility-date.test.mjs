import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCompatibilityDates } from "../../scripts/assert-cloudflare-compatibility-date.mjs";

function input(date, options = {}) {
  return {
    configs: [
      { path: "member", source: `{\n  "compatibility_date": "${date}",\n}` },
    ],
    workerdVersions: ["1.20261006.1"],
    now: new Date("2026-10-15T21:25:35Z"),
    ...options,
  };
}

test("accepts the pinned runtime date for both app configurations", () => {
  const values = input("2026-10-06");
  values.configs.push({ path: "admin", source: values.configs[0].source });
  const result = assertCompatibilityDates(values);
  assert.equal(result.dates.length, 2);
  assert.equal(result.runtimeDate, "2026-10-06");
});

test("rejects the observed KST-next-day configuration before UTC advances", () => {
  assert.throws(
    () => assertCompatibilityDates(input("2026-10-16")),
    /future in UTC/,
  );
});

test("rejects dates newer than the installed runtime even when UTC permits them", () => {
  assert.throws(
    () => assertCompatibilityDates(input("2026-10-15")),
    /pinned workerd support/,
  );
});

test("rejects invalid calendar days rather than normalizing them", () => {
  assert.throws(
    () => assertCompatibilityDates(input("2026-02-29")),
    /date is invalid/,
  );
});

test("requires a known unambiguous runtime version", () => {
  for (const versions of [[], ["latest"], ["1.20261006.1", "1.20260901.0"]])
    assert.throws(() =>
      assertCompatibilityDates(
        input("2026-10-06", { workerdVersions: versions }),
      ),
    );
});

test("rejects missing or duplicate configuration dates", () => {
  for (const source of [
    "{}",
    '{"compatibility_date": "2026-10-06", "compatibility_date": "2026-10-06"}',
  ])
    assert.throws(
      () =>
        assertCompatibilityDates(
          input("2026-10-06", { configs: [{ path: "member", source }] }),
        ),
      /exactly one/,
    );
});

test("rejects commented decoys rather than accepting a hidden future date", () => {
  const source =
    '{\n/*\n"compatibility_date": "2026-10-06",\n*/\n"compatibility_date": "2026-10-16", // real value\n}';
  assert.throws(
    () =>
      assertCompatibilityDates(
        input("2026-10-06", { configs: [{ path: "member", source }] }),
      ),
    /comments are not permitted/,
  );
});

test("preserves string punctuation and reads escaped or inline date keys", () => {
  const source =
    '{"vars":{"example":"https://example.com/a,}/*literal*/"},"compatibility_\\u0064ate":"2026-10-06",}';
  assert.equal(
    assertCompatibilityDates(
      input("2026-10-06", { configs: [{ path: "member", source }] }),
    ).dates[0].date,
    "2026-10-06",
  );
});
