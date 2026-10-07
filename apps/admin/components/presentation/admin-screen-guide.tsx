"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import styles from "./admin-screen-guide.module.css";

const guides = {
  "/": {
    title: "오늘의 퍼뜩",
    check:
      "조회하지 못한 항목을 먼저 확인하고, 안전 모드·예외·출금 순서로 살펴보세요.",
    caution: "대기 목록이 비어 있어도 서비스 전체가 정상이라는 뜻은 아닙니다.",
  },
  "/members": {
    title: "회원 종합 정보",
    check:
      "이름·아이디·전화번호로 회원을 찾고, 상태·입출금·최근 기록을 함께 확인하세요.",
    caution:
      "이름이 같거나 일부 기록이 빠져 있다면 신원이나 처리 완료를 단정하지 마세요.",
  },
  "/assistant": {
    title: "운영 도우미",
    check: "실제 기록을 조회하고, 입금 내역에서 검토할 초안을 준비하세요.",
    caution:
      "초안 준비는 승인이 아닙니다. 최종 처리 화면에서 금액과 증빙을 확인하세요.",
  },
  "/deposits/krw": {
    title: "원화 입금 확인",
    check: "신청 회원·금액·입금 증빙과 이미 처리된 기록을 대조하세요.",
    caution: "반영 결과를 확인하기 전에는 입금 완료를 안내하지 마세요.",
  },
  "/deposits/usdt": {
    title: "USDT 입금 확인",
    check: "회원·네트워크·송금 증빙과 반영할 원화 금액을 차례로 검토하세요.",
    caution:
      "다른 신청의 증빙을 재사용하지 마세요. 실제 반영 결과를 확인하세요.",
  },
  "/withdrawals/krw-bank": {
    title: "계좌 출금",
    check: "신청 대상·실제 송금·송금 증빙·최종 처리 상태를 나눠 확인하세요.",
    caution: "이미 송금한 요청을 다시 송금하거나 보류 금액을 해제하지 마세요.",
  },
  "/withdrawals/usdt": {
    title: "USDT 출금",
    check: "신청 대상·네트워크·실제 송금 증빙과 최종 처리 상태를 확인하세요.",
    caution: "화면의 예상 금액은 실제 송금 완료를 뜻하지 않습니다.",
  },
  "/kyc": {
    title: "본인 확인 검토",
    check: "실제 제출 자료와 위험 신호를 읽고 검토 이유를 남기세요.",
    caution: "제출 자료를 확인할 수 없다면 승인하지 마세요.",
  },
  "/exceptions": {
    title: "정산·대사 예외",
    check: "거래 기록의 차이와 실패한 작업, 발견 시각을 확인하세요.",
    caution: "조사 상태를 저장해도 잔액이나 실패한 작업이 수정되지는 않습니다.",
  },
  "/restrictions": {
    title: "제한·안전 모드",
    check: "멈춘 기능과 영향받는 회원, 변경할 범위를 확인하세요.",
    caution: "안전 모드를 해제하기 전에 장애 원인과 거래 영향을 검토하세요.",
  },
  "/economy": {
    title: "채굴 정책",
    check:
      "현재 정책과 변경 미리보기를 비교하고 승인된 값과 적용 시점을 확인하세요.",
    caution: "미확정 값을 추정해 활성화하지 마세요.",
  },
  "/catalog": {
    title: "상품 검토",
    check:
      "상품 출처와 공개 상태를 확인하고 승인할 내용과 적용 시점을 검토하세요.",
    caution:
      "원금 등급으로 상품 접근을 제한하지 않습니다. 미승인 배수는 활성화하지 마세요.",
  },
} as const;

/** Static screen instructions only: not live evidence, an AI answer or a command. */
export function AdminScreenGuide() {
  const pathname = usePathname();
  const details = useRef<HTMLDetailsElement>(null);
  const guide = Object.entries(guides).find(
    ([route]) =>
      pathname === route || (route !== "/" && pathname.startsWith(`${route}/`)),
  )?.[1];

  useEffect(() => {
    if (details.current) details.current.open = false;
    function close(event: Event) {
      if (!details.current?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      } else if (
        event.type === "pointerdown" &&
        event.target instanceof Node &&
        !details.current.contains(event.target)
      ) {
        details.current.open = false;
      }
    }
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [pathname]);

  if (!guide) return null;
  return (
    <details ref={details} className={styles.root}>
      <summary>이 화면 안내</summary>
      <section className={styles.panel} aria-label="운영 화면 사용 안내">
        <header>
          <strong>{guide.title}</strong>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (details.current) {
                details.current.open = false;
                details.current.querySelector("summary")?.focus();
              }
            }}
          >
            닫기
          </button>
        </header>
        <h2>먼저 확인하세요</h2>
        <p>{guide.check}</p>
        <h2>처리 전 주의하세요</h2>
        <p>{guide.caution}</p>
        <p className={styles.boundary}>
          화면 사용 방법을 설명하는 안내입니다. 최신 상태는 본문의 조회 시각과
          실제 기록에서 확인하세요.
        </p>
      </section>
    </details>
  );
}
