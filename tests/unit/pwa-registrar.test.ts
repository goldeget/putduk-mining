// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaRegistrar } from "@/components/system/pwa-registrar";

let root: Root;
let host: HTMLDivElement;
const register = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubEnv("NODE_ENV", "production");
  register.mockReset().mockResolvedValue({});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
});
async function mount() {
  await act(async () => root.render(createElement(PwaRegistrar)));
}

describe("production PWA registration lifecycle", () => {
  it("keeps the application available if device registration fails", async () => {
    register.mockRejectedValue(new Error("storage denied"));
    await mount();
    expect(register).toHaveBeenCalledOnce();
    expect(host.textContent).toBe("");
  });
  it("does not register in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await mount();
    expect(register).not.toHaveBeenCalled();
  });
  it("does not register on an unsupported device", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    await mount();
    expect(register).not.toHaveBeenCalled();
  });
});
