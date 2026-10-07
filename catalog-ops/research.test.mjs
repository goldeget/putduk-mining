import test from "node:test";
import assert from "node:assert/strict";
import { loadPackage, validatePackage } from "./validate.mjs";

test("all 55 current candidates use evidence-qualified identity states", () => {
  const data = loadPackage();
  assert.equal(data.candidates.candidates.length, 55);
  assert.equal(data.candidates.research_revision, 2);
  assert.ok(
    data.candidates.candidates.every((p) =>
      /^PUBLIC_MARKET_(?:VERIFIED|PARTIAL|UNKNOWN)$/.test(p.identity_status),
    ),
  );
  assert.equal(validatePackage(data).ok, true);
  assert.equal(data.research.completed, false);
});

test("SEC actually identifies SPCX; missing share class stays partial", () => {
  const p = loadPackage().candidates.candidates.find(
    (p) => p.slug === "spacex",
  );
  assert.equal(p.canonical_ticker, "SPCX");
  assert.equal(p.canonical_exchange, "Nasdaq");
  assert.equal(p.identity_status, "PUBLIC_MARKET_PARTIAL");
  assert.equal(p.canonical_share_class, null);
  assert.match(
    p.verified_facts[0].quote,
    /SPACE EXPLORATION TECHNOLOGIES CORP/,
  );
});

test("lossless downloaded response hashes are validated, not URL-only evidence", () => {
  const data = loadPackage();
  const source = data.research.sources.find((s) => s.id === "sec");
  assert.equal(data.sourceResponseHashes.sec, source.response_sha256);
  data.sourceResponseHashes.sec = "0".repeat(64);
  assert.ok(
    validatePackage(data).errors.some(
      (e) => e.code === "UNPROVEN_OR_STALE_SOURCE",
    ),
  );
});

test("a successful Invesco QQQ response cannot verify ProShares TQQQ", () => {
  const data = loadPackage();
  const p = data.candidates.candidates.find((p) => p.slug === "tqqq-review");
  assert.equal(p.identity_status, "PUBLIC_MARKET_UNKNOWN");
  assert.equal(p.canonical_name, null);
  assert.deepEqual(p.verified_facts, []);
});

test("a real primary sponsor response resolves the AI investigation slot only partially", () => {
  const p = loadPackage().candidates.candidates.find(
    (p) => p.slug === "kr-ai-etf-research",
  );
  assert.equal(p.canonical_ticker, "471990");
  assert.equal(p.identity_status, "PUBLIC_MARKET_PARTIAL");
  assert.equal(p.effective_wave, "HOLD");
});

test("current sponsor identity supersedes the historical VTI name hint", () => {
  const p = loadPackage().candidates.candidates.find((p) => p.slug === "vti");
  assert.equal(p.canonical_name, "Vanguard Morningstar Total Stock Market ETF");
  assert.equal(p.canonical_exchange, "NYSE Arca");
});
