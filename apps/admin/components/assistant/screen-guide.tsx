"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Route } from "next";
import type { AdminRole } from "@/lib/auth/policy";
import {
  isOperationSection,
  operationSections,
} from "@/lib/operations/registry";
import styles from "../operations/operations.module.css";

const guides = {
  "/": {
    title: "오늘의 퍼뜩",
    lead: "조회되지 않은 항목부터 확인하고, 안전 모드·거래 차이·출금 순서로 살펴보세요.",
    boundary: "대기 항목이 없어도 서비스 전체가 정상이라는 뜻은 아니에요.",
  },
  "/members": {
    title: "회원 종합 정보",
    lead: "이름과 가입 시각으로 회원을 선택한 뒤, 상태·자금 출처·입출금·최근 기록을 함께 확인하세요.",
    boundary:
      "이름이 같거나 기록이 일부 빠져 있으면 신원이나 처리 완료를 단정하지 마세요.",
  },
  "/assistant": {
    title: "운영 도우미",
    lead: "실제 조회 기록을 확인하고, 기존 입금 양식에 넣을 초안을 준비하세요.",
    boundary:
      "초안 준비는 승인이 아니에요. 금액과 사유를 바꾸면 다시 검토해야 해요.",
  },
  "/deposits/krw": {
    title: "원화 입금 확인",
    lead: "신청 금액·입금 증빙·이미 처리된 신청을 대조하고, 실제 받은 금액을 확인하세요.",
    boundary:
      "비슷한 신청만으로 중복 이체를 판단하지 마세요. 반영 결과를 확인하기 전에는 완료를 안내하지 마세요.",
  },
  "/deposits/usdt": {
    title: "USDT 입금 확인",
    lead: "회원·네트워크·송금 증빙과 입금 양식의 반영 금액을 차례로 검토하세요.",
    boundary:
      "잘못된 네트워크나 다른 신청의 증빙을 재사용하지 마세요. 원화 반영은 서버의 실제 결과를 확인해요.",
  },
  "/withdrawals/krw-bank": {
    title: "계좌 출금",
    lead: "대상·실제 송금·송금 증빙·원장 확정 상태를 나눠 확인하세요.",
    boundary: "이미 송금된 요청을 다시 송금하거나 보류 금액을 해제하지 마세요.",
  },
  "/withdrawals/usdt": {
    title: "USDT 출금",
    lead: "대상·네트워크·실제 송금 증빙·확정 상태를 확인하세요.",
    boundary:
      "화면의 예상 금액은 외부 송금 완료 증거가 아니에요. 최종 결과는 서버 기록과 대조하세요.",
  },
  "/kyc": {
    title: "본인 확인 검토",
    lead: "실제 제출 자료와 위험 신호를 읽고, 검토 이유를 남기세요.",
    boundary: "제출 자료를 확인할 수 없으면 승인을 진행하지 마세요.",
  },
  "/exceptions": {
    title: "정산·대사 예외",
    lead: "기대 기록과 실제 기록의 차이, 실패한 작업과 발견 시각을 확인하세요.",
    boundary:
      "조사 상태 저장은 잔액 수리나 작업 복구가 아니에요. 해석되지 않은 증거는 담당자 검토가 필요해요.",
  },
  "/restrictions": {
    title: "제한·안전 모드",
    lead: "어떤 기능이 누구에게 영향을 주는지 확인하고, 변경 범위와 이유를 검토하세요.",
    boundary:
      "안전 모드를 해제하기 전에 장애 원인과 거래에 미치는 영향을 확인하세요.",
  },
  "/economy": {
    title: "채굴 정책",
    lead: "현재 서버 정책과 변경 미리보기를 비교하고, 승인된 값과 적용 시점을 확인하세요.",
    boundary:
      "정책 값이나 금전 효과를 추정하지 마세요. 미확정 값은 직접 활성화하지 마세요.",
  },
} as const;

export function ScreenGuide({ role }: { role: AdminRole }) {
  const pathname = usePathname();
  const details = useRef<HTMLDetailsElement>(null);
  const section = pathname.split("/")[2];
  const guide =
    pathname.startsWith("/operations/") && isOperationSection(section ?? "")
      ? operationSections[section as keyof typeof operationSections]
      : (Object.entries(guides).find(
          ([route]) =>
            pathname === route ||
            (route !== "/" && pathname.startsWith(`${route}/`)),
        )?.[1] ?? guides["/"]);
  useEffect(() => {
    if (details.current) details.current.open = false;
    const close = (event: Event) => {
      if (!details.current?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        details.current.open = false;
        details.current.querySelector<HTMLElement>("summary")?.focus();
      } else if (
        event.type === "pointerdown" &&
        event.target instanceof Node &&
        !details.current.contains(event.target)
      ) {
        details.current.open = false;
      }
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [pathname]);
  return (
    <details ref={details} className={styles.screenGuide}>
      <summary>이 화면 안내</summary>
      <section className={styles.guidePanel} aria-label="운영 도우미 화면 안내">
        <header>
          <strong>운영 도우미 · {guide.title}</strong>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              if (details.current) {
                details.current.open = false;
                details.current.querySelector<HTMLElement>("summary")?.focus();
              }
            }}
          >
            닫기
          </button>
        </header>
        <h2>여기서 확인할 것</h2>
        <p>{guide.lead}</p>
        <h2>지금 주의할 것</h2>
        <p>{guide.boundary}</p>
        <h2>아직 확인하지 못한 것</h2>
        <p>
          이 안내는 화면 사용 설명이에요. 최신 금액·회원 상태·실제 이체 결과를
          조회하거나 모델이 판단한 답변이 아니에요. 본문의 조회 시각과 실제
          기록을 확인해 주세요.
        </p>
        <div className={styles.links}>
          <Link className="text-link" href="/">
            오늘 확인할 일
          </Link>
          {["SUPER_ADMIN", "ADMIN"].includes(role) ? (
            <Link className="text-link" href={"/assistant" as Route}>
              기존 입금 초안 준비
            </Link>
          ) : null}
        </div>
      </section>
    </details>
  );
}
