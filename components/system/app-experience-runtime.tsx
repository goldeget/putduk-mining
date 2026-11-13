"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PwaRegistrar } from "./pwa-registrar";
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
function subscribeStandalone(listener: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", listener);
  window.addEventListener("appinstalled", listener);
  return () => {
    media.removeEventListener("change", listener);
    window.removeEventListener("appinstalled", listener);
  };
}
function standaloneSnapshot() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
const subscribePlatform = () => () => undefined;
function iosSnapshot() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Optional install assistance. Installation and permission never gate START. */
export function AppInstallControl() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    standaloneSnapshot,
    () => false,
  );
  const ios = useSyncExternalStore(subscribePlatform, iosSnapshot, () => false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
      setStatus("홈 화면에 추가했습니다.");
    };
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  async function install() {
    const current = prompt;
    if (!current) return;
    setPrompt(null);
    try {
      await current.prompt();
      const choice = await current.userChoice;
      setStatus(
        choice.outcome === "accepted"
          ? "설치 요청을 받았습니다. 홈 화면에서 확인해 주세요."
          : "브라우저에서 계속 이용할 수 있어요.",
      );
    } catch {
      setStatus("브라우저 메뉴에서 홈 화면에 추가를 선택해 주세요.");
    }
  }
  return (
    <div className="push-control">
      <div>
        <strong>WORKROOM 앱 설치</strong>
        <p>
          {installed || standalone
            ? "홈 화면 앱으로 이용 중입니다."
            : ios
              ? "Safari에서 공유 버튼 → 홈 화면에 추가를 선택해 주세요. 알림은 홈 화면 앱을 연 뒤 직접 켤 수 있어요."
              : "브라우저 메뉴의 앱 설치 또는 홈 화면에 추가를 이용할 수 있어요."}
        </p>
        <p>
          설치와 알림을 선택하지 않아도 워크룸을 이용할 수 있어요.
          오프라인에서는 안내 화면만 열립니다.
        </p>
      </div>
      {prompt && !installed && !standalone ? (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void install()}
        >
          앱 설치
        </button>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}

/** Root mount has no floating control or automatic permission prompt. */
export function AppExperienceRuntime() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const refresh = () => setOffline(!navigator.onLine);
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);
  return (
    <>
      <PwaRegistrar />
      {offline ? (
        <p role="status" className="workroom-offline-status">
          인터넷 연결을 확인해 주세요. 최신 진행 상태와 문의는 다시 연결한 뒤
          확인할 수 있어요.
        </p>
      ) : null}
    </>
  );
}
