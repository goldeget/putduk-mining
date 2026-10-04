import { createElement, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { MiningAmountBoard } from "@/components/product/mining-amount-board";
import {
  presentMiningServerDisplay,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";

const readyDisplay: MiningServerDisplay = {
  available: true,
  eligible_principal_micro_krw: "100000000000",
  tier_code: "L1",
  tier_activated: true,
  cycle_started_at: "2026-10-04T01:00:00.000Z",
  cycle_end: "2026-11-03T01:00:00.000Z",
  effective_capacity_micro_krw: "15000000000",
  remaining_capacity_micro_krw: "15000000000",
  used_capacity_micro_krw: "0",
  speed_multiplier_bps: "10000",
  pending_micro_krw: "15000000000",
  retention_unconfirmed_micro_krw: "15000000000",
};

function markup(
  placement: "lead" | "follow" | "stack",
  view: ReturnType<typeof presentMiningServerDisplay> | null,
  error = false,
) {
  return renderToStaticMarkup(
    createElement(MiningAmountBoard, {
      error,
      placement,
      view,
    }) as ReactElement,
  );
}

describe("채굴 금액 카드 구도", () => {
  it("원금과 등급을 앞에 두고 용량, 속도, 정산 전을 카드로 나눈다", () => {
    const html = markup("stack", presentMiningServerDisplay(readyDisplay));
    const principal = html.indexOf("채굴 원금");
    const tier = html.indexOf("현재 등급");
    const pending = html.indexOf(">정산 전<");
    const speed = html.indexOf("채굴 속도");
    const capacity = html.indexOf("채굴 용량");
    const quiet = html.indexOf('data-amount-weight="unconfirmed"');

    expect(principal).toBeGreaterThan(-1);
    expect(principal).toBeLessThan(tier);
    expect(tier).toBeLessThan(pending);
    expect(pending).toBeLessThan(speed);
    expect(speed).toBeLessThan(capacity);
    expect(capacity).toBeLessThan(quiet);
    expect(html).toContain("100,000원");
    expect(html).toContain(">L1<");
    expect(html).toContain("1배");
    expect(html).toContain("이번 한도");
    expect(html).toContain("사용한 한도");
    expect(html).toContain("남은 한도");
    expect(html).toContain("0원");
    expect(html).not.toContain("30,000원");
    expect(html).not.toContain("18,489");
    expect(html).not.toContain("428");

    const lead = markup("lead", presentMiningServerDisplay(readyDisplay));
    expect(lead).toContain("채굴 원금");
    expect(lead).toContain("현재 등급");
    expect(lead).not.toContain("채굴 용량");
    expect(lead).not.toContain("채굴 속도");
  });

  it("확인 전은 확정 수익처럼 큰 칸이 아니다", () => {
    const html = markup("stack", presentMiningServerDisplay(readyDisplay));
    const quiet = html.match(
      /data-amount-weight="unconfirmed"[^>]*>[\s\S]*?<\/p>/,
    );
    expect(quiet?.[0]).toContain("15,000원");
    expect(quiet?.[0]).toContain("확정된 수익이 아니에요.");
    expect(quiet?.[0]).not.toContain("<dd");
    expect(quiet?.[0]).not.toContain("<strong");

    const css = readFileSync(
      "components/product/mining-amount-board.module.css",
      "utf8",
    );
    expect(css).toMatch(/\.moneyRetention\s*\{[^}]*border:\s*1px dashed/s);
    expect(css).toMatch(/\.moneyRetention\s*\{[^}]*font-size:\s*0\.75rem/s);
    expect(css).toMatch(
      /data-amount-weight="lead"\] dd\s*\{[^}]*clamp\(1\.05rem,\s*2\.4vw,\s*1\.4rem\)/s,
    );
    expect(css).not.toMatch(/#59e1af|rgb\(89\s*,\s*225\s*,\s*175\)/i);
  });

  it("금액이 없으면 빈 상태만 보여 준다", () => {
    const empty = presentMiningServerDisplay({
      ...readyDisplay,
      available: false,
      eligible_principal_micro_krw: null,
      tier_code: null,
      tier_activated: false,
      cycle_started_at: null,
      cycle_end: null,
      effective_capacity_micro_krw: null,
      remaining_capacity_micro_krw: null,
      used_capacity_micro_krw: null,
      speed_multiplier_bps: null,
      pending_micro_krw: null,
      retention_unconfirmed_micro_krw: null,
    });
    const follow = markup("follow", empty);
    expect(follow).toContain("채굴 금액은 아직 없어요.");
    expect(follow).not.toContain("채굴 원금");
    expect(markup("lead", empty)).toBe("");

    const failed = markup("follow", null, true);
    expect(failed).toContain("채굴 금액을 불러오지 못했어요");
    expect(markup("lead", null, true)).toBe("");
  });

  it("없는 칸은 0원으로 채우지 않는다", () => {
    const html = markup(
      "follow",
      presentMiningServerDisplay({
        ...readyDisplay,
        pending_micro_krw: null,
        speed_multiplier_bps: null,
        retention_unconfirmed_micro_krw: null,
      }),
    );
    expect(html).toContain(">정산 전</dt><dd>아직 없어요</dd>");
    expect(html).toContain(">채굴 속도</dt><dd>아직 없어요</dd>");
    expect(html).toContain("확인 전 금액은 아직 없어요.");
    expect(html).toContain("15,000원");
    expect(html).not.toContain(">정산 전</dt><dd>0원</dd>");
  });

  it("채굴 페이지는 카드를 위와 아래로 나누고 기간은 상세에 둔다", () => {
    const page = readFileSync("app/(product)/mining/page.tsx", "utf8");
    const css = readFileSync("app/(product)/mining/page.module.css", "utf8");
    const board = readFileSync(
      "components/product/mining-amount-board.tsx",
      "utf8",
    );

    expect(page).toContain("readOwnMiningServerDisplay(identity)");
    expect(page).toContain("resolveDefaultStageInput()");
    expect(page.indexOf('placement="lead"')).toBeGreaterThan(
      page.indexOf("hudTop"),
    );
    expect(page.indexOf('placement="lead"')).toBeLessThan(
      page.indexOf('placement="follow"'),
    );
    expect(page.indexOf('placement="follow"')).toBeGreaterThan(
      page.indexOf("hudBottom"),
    );
    expect(page).toContain('aria-label="채굴 기간"');
    expect(page).not.toContain("moneyFacts");
    expect(page).not.toContain("formatMiningMicroKrw");
    expect(page).not.toContain("Math.random");
    expect(css).toMatch(/\.hud\s*\{[^}]*justify-content:\s*space-between/s);
    expect(css).not.toMatch(/\.moneyFacts/);
    expect(board).not.toMatch(/Math\.random|setInterval|18,489|₩ 428/);
  });
});
