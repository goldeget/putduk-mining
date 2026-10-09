import { afterEach, describe, expect, it, vi } from "vitest";
const effect = vi.hoisted(() => ({
  callback: null as null | (() => void | (() => void)),
}));
vi.mock("react", () => ({
  useEffect: (callback: () => void | (() => void)) => {
    effect.callback = callback;
  },
}));
import { PwaRegistrar } from "@/components/system/pwa-registrar";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  effect.callback = null;
});
function mount(readyState: string) {
  const windowTarget = new EventTarget();
  const register = vi.fn().mockResolvedValue({});
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", { readyState });
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  PwaRegistrar();
  const cleanup = effect.callback?.();
  return { windowTarget, register, cleanup };
}
describe("production service worker load race", () => {
  it("registers immediately when hydration happens after the window load", () => {
    const { register, windowTarget, cleanup } = mount("complete");
    expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/" });
    windowTarget.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledTimes(1);
    cleanup?.();
  });
  it("registers once on the future load when hydration happens before it", () => {
    const { register, windowTarget, cleanup } = mount("interactive");
    expect(register).not.toHaveBeenCalled();
    windowTarget.dispatchEvent(new Event("load"));
    windowTarget.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/" });
    cleanup?.();
  });
  it("removes the pending listener when the registrar unmounts before load", () => {
    const { register, windowTarget, cleanup } = mount("loading");
    cleanup?.();
    windowTarget.dispatchEvent(new Event("load"));
    expect(register).not.toHaveBeenCalled();
  });
});
