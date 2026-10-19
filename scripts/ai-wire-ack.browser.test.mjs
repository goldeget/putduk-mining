import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { chromium } from "@playwright/test";

import * as diagnostics from "../tests/e2e/authenticated/helpers/ai-ack-diagnostics.ts";

const savedAck = {
  status: 200,
  bodyAvailable: true,
  doneCount: 1,
  doneSaved: true,
  conversationIdPresent: true,
  assistantMessageIdPresent: true,
};

test("actual no-store wire ACK stays strict, request-bound and isolated from fetch", async () => {
  assert.equal(typeof diagnostics.observeAiWireAck, "function");
  const encode = (value) => `data: ${JSON.stringify(value)}\n\n`;
  const done = encode({
    type: "done",
    saved: true,
    conversationId: "private-fixture-conversation",
    assistantMessageId: "private-fixture-message",
  });
  let gateResponse;
  let redirectReady = true;
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>wire ACK regression</title>");
      return;
    }
    const mode = request.headers["x-fixture-mode"] ?? "saved";
    if (request.url === "/fixture-redirect-bridge") {
      response.writeHead(307, {
        Location: "/api/v1/ai/chat",
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
        "Access-Control-Allow-Headers":
          "X-Fixture-Mode,X-Fixture-Case,Content-Type",
      });
      response.end();
      return;
    }
    if (mode === "redirect" && redirectReady) {
      redirectReady = false;
      response.writeHead(307, {
        Location: "/fixture-redirect-bridge",
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    if (mode === "redirect") redirectReady = true;
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-cache, no-store, no-transform",
      "Access-Control-Allow-Origin": "*",
    });
    response.write(encode({ type: "ready", source: "static" }));
    if (mode === "events")
      response.write(encode({ type: "delta" }).repeat(513));
    response.write(
      mode === "false"
        ? encode({ type: "done", saved: false })
        : mode === "duplicate"
          ? done + done
          : mode === "malformed"
            ? "data: {broken}\n\n"
            : done,
    );
    if (mode === "oversize") response.write("x".repeat(65_537));
    if (mode === "unicode") response.write("한".repeat(25_000));
    if (mode === "hang") return;
    if (mode === "gated") {
      gateResponse = response;
      return;
    }
    setTimeout(
      () => {
        if (mode === "destroy") response.destroy();
        else response.end();
      },
      mode === "slow" ? 120 : 35,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      const origin = `http://127.0.0.1:${server.address().port}`;
      await page.goto(origin);
      const native = await page.evaluateHandle(() => window.fetch);
      const observer = await diagnostics.observeAiWireAck(page);
      async function send(
        mode,
        id = crypto.randomUUID(),
        selectedObserver = observer,
      ) {
        const responsePromise = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/ai/chat" &&
            response.request().postDataJSON()?.clientMessageId === id,
        );
        const browserRead = page.evaluate(
          async ({ mode, id }) => {
            const abort = new AbortController();
            const timer = setTimeout(
              () => abort.abort(),
              mode === "hang" ? 5_500 : 1_000,
            );
            let eof = false;
            let readerOnlyCancelled = false;
            try {
              const response = await fetch("/api/v1/ai/chat", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Fixture-Mode": mode,
                },
                body: JSON.stringify({ clientMessageId: id }),
                signal: abort.signal,
              });
              const reader = response.body.getReader();
              try {
                while (true) {
                  const chunk = await reader.read();
                  if (chunk.done) {
                    eof = true;
                    break;
                  }
                  if (mode === "abort") abort.abort();
                  if (mode === "reader-cancel") {
                    readerOnlyCancelled = true;
                    await reader.cancel();
                    break;
                  }
                }
              } finally {
                reader.releaseLock();
              }
            } catch {
              // The original consumer is independently observed, never replaced.
            } finally {
              clearTimeout(timer);
            }
            return { eof, readerOnlyCancelled };
          },
          { mode, id },
        );
        const response = await responsePromise;
        const result = await selectedObserver.read(response);
        const original = await browserRead;
        return { result, original, response };
      }
      try {
        const normal = await send("saved");
        assert.deepEqual(normal.result.ack, savedAck);
        assert.equal(normal.original.eof, true);
        assert.deepEqual((await send("false")).result.ack, {
          ...savedAck,
          doneSaved: false,
          conversationIdPresent: false,
          assistantMessageIdPresent: false,
        });
        assert.equal((await send("duplicate")).result.ack.doneCount, 2);
        assert.equal((await send("malformed")).result.ack.doneCount, 0);
        assert.equal((await send("oversize")).result.body.outcome, "OVERSIZE");
        assert.equal((await send("events")).result.body.outcome, "COUNT_LIMIT");
        const missing = await send("saved", "");
        assert.equal(missing.result.body.outcome, "UNAVAILABLE");
        assert.equal(missing.original.eof, true);
        const readerOnly = await send("reader-cancel");
        assert.deepEqual(readerOnly.result.ack, savedAck);
        assert.equal(readerOnly.original.eof, false);
        assert.equal(readerOnly.original.readerOnlyCancelled, true);
        for (const mode of ["abort", "destroy", "hang"]) {
          const failure = await send(mode);
          assert.equal(failure.result.ack.bodyAvailable, false);
          assert.equal(failure.original.eof, false);
        }
        const reordered = await Promise.all([send("slow"), send("false")]);
        assert.deepEqual(
          reordered.map((row) => row.result.ack.doneSaved),
          [true, false],
          JSON.stringify(reordered.map((row) => row.result)),
        );
        const duplicateId = crypto.randomUUID();
        const ambiguous = await Promise.all([
          send("slow", duplicateId),
          send("false", duplicateId),
        ]);
        assert(
          ambiguous.every((row) => row.result.body.outcome === "AMBIGUOUS"),
        );
        assert(!JSON.stringify(normal.result).includes("private-fixture"));
      } finally {
        await observer.dispose();
      }
      assert.equal(
        await page.evaluate((native) => window.fetch === native, native),
        true,
      );
      // A failing clone never changes the real Response consumed by the app.
      const cloneFailure = await diagnostics.observeAiWireAck(page);
      await page.evaluate(() => {
        const clone = Response.prototype.clone;
        window.fixtureRestoreClone = () => {
          Response.prototype.clone = clone;
        };
        Response.prototype.clone = () => {
          throw new Error("private-clone-failure");
        };
      });
      try {
        const failure = await send("saved", crypto.randomUUID(), cloneFailure);
        assert.equal(failure.result.body.outcome, "READ_ERROR");
        assert.equal(failure.original.eof, true);
        assert(!JSON.stringify(failure.result).includes("private-clone"));
      } finally {
        await page.evaluate(() => window.fixtureRestoreClone());
        await cloneFailure.dispose();
      }
      // The wrapper must return the same native Promise, Response, and error.
      await page.evaluate(() => {
        const original = window.fetch;
        window.fixtureRestoreFetch = () => {
          window.fetch = original;
        };
        window.fetch = function (...args) {
          const pending = original.apply(this, args);
          window.fixtureNativePromise = pending;
          return pending;
        };
      });
      const identity = await diagnostics.observeAiWireAck(page);
      try {
        const identities = await page.evaluate(async () => {
          const pending = fetch("/api/v1/ai/chat", {
            method: "POST",
            headers: { "X-Fixture-Mode": "saved" },
            body: JSON.stringify({ clientMessageId: crypto.randomUUID() }),
          });
          const samePromise = pending === window.fixtureNativePromise;
          const response = await pending;
          const sameResponse = response === (await window.fixtureNativePromise);
          await response.text();
          return { samePromise, sameResponse };
        });
        assert.deepEqual(identities, { samePromise: true, sameResponse: true });
      } finally {
        await identity.dispose();
        await page.evaluate(() => window.fixtureRestoreFetch());
      }
      await page.evaluate(() => {
        const original = window.fetch;
        window.fixtureRestoreFetch = () => {
          window.fetch = original;
        };
        window.fixtureNativeError = new Error("private-native-error");
        window.fetch = () => {
          const pending = Promise.reject(window.fixtureNativeError);
          pending.catch(() => undefined);
          window.fixtureNativePromise = pending;
          return pending;
        };
      });
      const rejection = await diagnostics.observeAiWireAck(page);
      try {
        const same = await page.evaluate(async () => {
          const pending = fetch("/api/v1/ai/chat", {
            method: "POST",
            body: JSON.stringify({ clientMessageId: crypto.randomUUID() }),
          });
          const samePromise = pending === window.fixtureNativePromise;
          try {
            await pending;
            return { samePromise, sameError: false };
          } catch (error) {
            return {
              samePromise,
              sameError: error === window.fixtureNativeError,
            };
          }
        });
        assert.deepEqual(same, { samePromise: true, sameError: true });
      } finally {
        await rejection.dispose();
        await page.evaluate(() => window.fixtureRestoreFetch());
      }
      const capped = await diagnostics.observeAiWireAck(page);
      try {
        const lastId = crypto.randomUUID();
        const lastResponse = page.waitForResponse(
          (response) =>
            response.request().postDataJSON()?.clientMessageId === lastId,
        );
        await page.evaluate(async (lastId) => {
          for (let index = 0; index < 17; index++) {
            const response = await fetch("/api/v1/ai/chat", {
              method: "POST",
              body: JSON.stringify({
                clientMessageId: index === 16 ? lastId : crypto.randomUUID(),
              }),
            });
            await response.text();
          }
        }, lastId);
        assert.equal(
          (await capped.read(await lastResponse)).body.outcome,
          "COUNT_LIMIT",
        );
      } finally {
        await capped.dispose();
      }
      const race = await diagnostics.observeAiWireAck(page);
      try {
        const gatedId = crypto.randomUUID();
        const gatedHeaders = page.waitForResponse(
          (response) =>
            response.request().postDataJSON()?.clientMessageId === gatedId,
        );
        const gatedBody = page.evaluate(async (id) => {
          const response = await fetch("/api/v1/ai/chat", {
            method: "POST",
            headers: { "X-Fixture-Mode": "gated" },
            body: JSON.stringify({ clientMessageId: id }),
          });
          await response.text();
        }, gatedId);
        const gatedResponse = await gatedHeaders;
        await page.evaluate((id) => {
          const entry = window.__putdukTestAiWireAck.entries.get(id);
          const actual = entry.promise;
          window.fixtureAckAwaitEntered = false;
          // Synchronization only: preserve the actual wire promise and result.
          entry.promise = {
            then(resolve, reject) {
              window.fixtureAckAwaitEntered = true;
              return actual.then(resolve, reject);
            },
          };
        }, gatedId);
        const pendingRead = race.read(gatedResponse);
        await page.waitForFunction(
          () => window.fixtureAckAwaitEntered === true,
        );
        assert.equal(gateResponse.writableFinished, false);
        await page.evaluate(async () => {
          for (let index = 0; index < 16; index++) {
            await (
              await fetch("/api/v1/ai/chat", {
                method: "POST",
                body: JSON.stringify({ clientMessageId: crypto.randomUUID() }),
              })
            ).text();
          }
        });
        gateResponse.end();
        assert.equal((await pendingRead).body.outcome, "COUNT_LIMIT");
        await gatedBody;
      } finally {
        gateResponse?.end();
        await race.dispose();
      }
      const boundaries = await diagnostics.observeAiWireAck(page);
      try {
        for (const fixtureCase of [
          "get",
          "query",
          "path",
          "origin",
          "uuid",
          "redirect",
        ]) {
          const caseId = crypto.randomUUID();
          const responsePromise = page
            .waitForResponse(
              (response) =>
                response.status() === 200 &&
                (fixtureCase === "redirect"
                  ? response.request().redirectedFrom() !== null &&
                    new URL(response.url()).origin === origin &&
                    new URL(response.url()).pathname === "/api/v1/ai/chat"
                  : response.request().headers()["x-fixture-case"] === caseId),
              { timeout: 5_000 },
            )
            .catch(() => {
              throw new Error(`FIXTURE_BOUNDARY_RESPONSE_${fixtureCase}`);
            });
          const original = page
            .evaluate(
              async ({ fixtureCase, caseId, origin }) => {
                const path =
                  fixtureCase === "query"
                    ? "/api/v1/ai/chat?fixture=1"
                    : fixtureCase === "path"
                      ? "/api/v1/ai/chat-other"
                      : "/api/v1/ai/chat";
                const url =
                  fixtureCase === "origin"
                    ? origin.replace("127.0.0.1", "localhost") + path
                    : path;
                const response = await fetch(url, {
                  method: fixtureCase === "get" ? "GET" : "POST",
                  headers: {
                    "X-Fixture-Case": caseId,
                    "X-Fixture-Mode":
                      fixtureCase === "redirect" ? "redirect" : "saved",
                  },
                  ...(fixtureCase === "get"
                    ? {}
                    : {
                        body: JSON.stringify({
                          clientMessageId:
                            fixtureCase === "uuid"
                              ? "malformed"
                              : crypto.randomUUID(),
                        }),
                      }),
                });
                await response.text();
                return true;
              },
              { fixtureCase, caseId, origin },
            )
            .catch(() => {
              throw new Error(`FIXTURE_BOUNDARY_FETCH_${fixtureCase}`);
            });
          void original.catch(() => undefined);
          assert.equal(
            (await boundaries.read(await responsePromise)).body.outcome,
            "UNAVAILABLE",
            fixtureCase,
          );
          assert.equal(await original, true, fixtureCase);
        }
        const unicode = await send("unicode", crypto.randomUUID(), boundaries);
        assert.equal(unicode.result.body.outcome, "OVERSIZE");
        assert.equal(unicode.original.eof, true);
      } finally {
        await boundaries.dispose();
      }
      await page.evaluate(() => {
        const original = window.fetch;
        window.fixtureRestoreFetch = () => {
          window.fetch = original;
        };
        window.fixtureSyncError = new Error("private-sync-error");
        window.fetch = () => {
          throw window.fixtureSyncError;
        };
      });
      const synchronous = await diagnostics.observeAiWireAck(page);
      try {
        assert.equal(
          await page.evaluate(() => {
            try {
              fetch("/api/v1/ai/chat", {
                method: "POST",
                body: JSON.stringify({ clientMessageId: crypto.randomUUID() }),
              });
              return false;
            } catch (error) {
              return error === window.fixtureSyncError;
            }
          }),
          true,
        );
      } finally {
        await synchronous.dispose();
        await page.evaluate(() => window.fixtureRestoreFetch());
      }
      const replaced = await diagnostics.observeAiWireAck(page);
      const replacement = await page.evaluateHandle(() => {
        const previous = window.fetch;
        window.fetch = function (...args) {
          return previous.apply(this, args);
        };
        return window.fetch;
      });
      await replaced.dispose();
      assert.equal(
        await page.evaluate(
          (replacement) => window.fetch === replacement,
          replacement,
        ),
        true,
      );
      await page.evaluate((native) => {
        window.fetch = native;
      }, native);
      const navigating = await diagnostics.observeAiWireAck(page);
      const headers = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/v1/ai/chat",
      );
      const draining = page.evaluate(async () => {
        const response = await fetch("/api/v1/ai/chat", {
          method: "POST",
          headers: { "X-Fixture-Mode": "slow" },
          body: JSON.stringify({ clientMessageId: crypto.randomUUID() }),
        });
        const reader = response.body.getReader();
        try {
          while (!(await reader.read()).done) {}
          return true;
        } finally {
          reader.releaseLock();
        }
      });
      const inFlight = await headers;
      await navigating.dispose();
      assert.equal(await draining, true);
      assert.equal(
        (await navigating.read(inFlight)).body.outcome,
        "UNAVAILABLE",
      );
      const afterNavigation = await diagnostics.observeAiWireAck(page);
      await page.goto(origin);
      assert.equal(
        (await afterNavigation.read(inFlight)).body.outcome,
        "UNAVAILABLE",
      );
      await afterNavigation.dispose();
      assert.equal(await page.evaluate(() => typeof window.fetch), "function");
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
