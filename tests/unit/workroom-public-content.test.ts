import { describe, expect, it } from "vitest";
import { TRUST_DOCUMENTS as archived } from "@/lib/trust/public-content";
import { LEGAL_DOCUMENTS } from "@/lib/trust/legal-content";
import { PUBLIC_FACTS, TRUST_DOCUMENTS } from "@/lib/workroom/public-content";
import {
  getPublicFactDisplayValue,
  getTrustNavigationLabel,
} from "@/lib/workroom/public-presentation";

describe("current WORKROOM public guidance", () => {
  it("renders the current product type without the old mining translation", () => {
    const fact = PUBLIC_FACTS.find((item) => item.key === "PRODUCT_TYPE")!;
    expect(getPublicFactDisplayValue(fact)).toBe("무료 시뮬레이션");
    expect(getTrustNavigationLabel("/mining-rules")).toBe("회차 규칙");
  });
  it("preserves archived consent records and limits the current display to the five approved feature corrections", () => {
    const legal = archived.filter((document) => document.consentVersion);
    const archivedBefore = JSON.stringify(legal);
    expect(legal).toHaveLength(2);
    const corrected: string[] = [];
    for (const document of legal) {
      expect(document).toBe(
        LEGAL_DOCUMENTS.find((original) => original.path === document.path),
      );
      const current = TRUST_DOCUMENTS.find(
        (item) => item.path === document.path,
      )!;
      const { sections, ...recordedMetadata } = document;
      const { sections: displayedSections, ...displayedMetadata } = current;
      expect(displayedMetadata).toEqual(recordedMetadata);
      expect(displayedSections).toHaveLength(sections.length);
      const approved: Record<string, Partial<(typeof sections)[number]>> = {
        "/terms:WORKROOM 체험": {
          body: [
            "가입 시 체험 포인트 100,000 P를 한 번 지급해요.",
            "체험 기록은 실제 지갑과 따로 보관돼요. 그대로 실제 자산이 되지 않아요.",
          ],
          items: [
            "체험 포인트와 모의 손익은 현금으로 전환하거나 출금할 수 없어요.",
            "회차별 패턴과 진행 시간, 종료 변동률은 참여 전에 확인해요.",
            "무료 체험을 위해 입금하지 않아도 돼요.",
          ],
        },
        "/terms:채굴과 결과": {
          heading: "모의 회차와 결과",
          body: [
            "앱을 닫아도 회차는 서버 시간을 기준으로 진행돼요. 다시 접속하면 결과를 확인할 수 있어요.",
          ],
          items: [
            "회차는 참여 전에 확인한 패턴과 진행 시간, 종료 변동률을 따라요.",
            "참고 시세와 모의 회차의 결과는 따로 표시해요.",
            "이용할 수 있는 항목은 운영자가 공개한 목록에서 확인해요.",
          ],
        },
        "/terms:점검과 이용 제한": {
          body: [
            "안전을 위해 가입, 입금, 출금, 모의 회차 같은 기능을 잠시 멈출 수 있어요.",
            "멈춘 동안에도 기록은 남아요.",
            "위험 신호가 확인되면 이용이 제한될 수 있어요.",
          ],
        },
        "/privacy:본인 확인 서류": {
          body: [
            "출금 전에 본인 확인이 필요할 수 있어요.",
            "제출한 서류는 확인할 때만 운영자가 열어 봐요. 열어 본 기록이 남아요.",
          ],
        },
        "/privacy:이용 기록": {
          body: [
            "서비스를 쓰는 동안 일부 행동이 기록돼요. 예를 들면 가입 완료와 입금 요청이에요.",
            "실제 입금·출금과 모의 회차는 서로 다른 기록으로 보관해요.",
          ],
        },
      };
      sections.forEach((section, index) => {
        const key = `${document.path}:${section.heading}`;
        const correction = approved[key];
        expect(displayedSections[index], key).toEqual(
          correction ? { ...section, ...correction } : section,
        );
        if (correction) corrected.push(key);
      });
    }
    expect(corrected).toHaveLength(5);
    expect(JSON.stringify(legal)).toBe(archivedBefore);
    expect(archivedBefore).toContain("최대 5,000원");
    expect(archivedBefore).toContain("사용량 100%");
    const active = JSON.stringify(
      TRUST_DOCUMENTS.filter((document) => document.consentVersion),
    );
    expect(active).not.toMatch(/5,000원|24시간|사용량 100%|채굴|체험 전환/);
    expect(active).toContain("현금으로 전환하거나 출금할 수 없어요");
    expect(active).toContain("실제 입금·출금과 모의 회차는 서로 다른 기록");
  });
  it("replaces historical mining and cash reward promises in active guidance", () => {
    const guidance = TRUST_DOCUMENTS.filter(
      (document) => !document.consentVersion,
    );
    const copy = JSON.stringify(guidance);
    expect(copy).not.toMatch(/채굴|5,000원|PUTDUK MINING/);
    expect(copy).toContain("현금으로 바꿀 수 없어요");
    expect(copy).toContain("사전 설정된 패턴");
    expect(
      PUBLIC_FACTS.find((fact) => fact.key === "PRODUCT_NAME")?.value,
    ).toBe("WORKROOM");
  });
});
