export type DepositDomPhase =
  | "boot"
  | "reload-ready"
  | "method-before"
  | "method-after"
  | "assert-before"
  | "failure";

type HiddenReason =
  | "react-stream"
  | "hidden"
  | "inert"
  | "aria-hidden"
  | "display-none"
  | "visibility-hidden"
  | "content-visibility-hidden";

type DepositDomRecord = {
  sequence: number;
  elapsedMs: number;
  source: "mutation" | "mark";
  phase: DepositDomPhase;
  amountCount: number;
  routeCount: number;
  mainCount: number;
  nodes: Array<{ reasons: HiddenReason[] }>;
};

export type DepositDomReport = { records: DepositDomRecord[]; dropped: number };

declare global {
  interface Window {
    __putdukDepositDiagnostics?: {
      mark(phase: DepositDomPhase): void;
      read(): DepositDomReport;
    };
  }
}

/** Self-contained for Playwright addInitScript; never mutates product DOM. */
export function startDepositDomDiagnostics() {
  if (window.__putdukDepositDiagnostics) return;
  const records: DepositDomRecord[] = [];
  const startedAt = performance.now();
  let phase: DepositDomPhase = "boot";
  let sequence = 0;
  let dropped = 0;
  let previous = "";
  const capture = (source: "mutation" | "mark") => {
    const amounts = document.querySelectorAll("#deposit-amount");
    const snapshot = {
      amountCount: amounts.length,
      routeCount: document.querySelectorAll('[data-ui-ready="/wallet/deposit"]')
        .length,
      mainCount: document.querySelectorAll("main").length,
      nodes: Array.from(amounts)
        .slice(0, 4)
        .map((amount) => {
          const reasons = new Set<HiddenReason>();
          for (
            let node: Element | null = amount;
            node;
            node = node.parentElement
          ) {
            if (node.id.startsWith("S:")) reasons.add("react-stream");
            if (node.hasAttribute("hidden")) reasons.add("hidden");
            if (node.hasAttribute("inert")) reasons.add("inert");
            if (node.getAttribute("aria-hidden") === "true")
              reasons.add("aria-hidden");
            const style = getComputedStyle(node);
            if (style.display === "none") reasons.add("display-none");
            if (
              style.visibility === "hidden" ||
              style.visibility === "collapse"
            )
              reasons.add("visibility-hidden");
            if (style.contentVisibility === "hidden")
              reasons.add("content-visibility-hidden");
          }
          return { reasons: Array.from(reasons) };
        }),
    };
    const signature = JSON.stringify(snapshot);
    if (source === "mutation" && signature === previous) return;
    previous = signature;
    records.push({
      sequence: sequence++,
      elapsedMs: Math.round(performance.now() - startedAt),
      source,
      phase,
      ...snapshot,
    });
    if (records.length > 16) {
      records.shift();
      dropped++;
    }
  };
  window.__putdukDepositDiagnostics = {
    mark(next) {
      phase = next;
      capture("mark");
    },
    read: () => ({
      records: records.map((record) => ({
        ...record,
        nodes: record.nodes.map((node) => ({ reasons: [...node.reasons] })),
      })),
      dropped,
    }),
  };
  const observer = new MutationObserver(() => capture("mutation"));
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "hidden",
      "inert",
      "aria-hidden",
      "style",
      "class",
      "id",
      "data-ui-ready",
    ],
  });
  capture("mark");
  return () => {
    observer.disconnect();
    delete window.__putdukDepositDiagnostics;
  };
}
