"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import styles from "./operations.module.css";

const tasks = [
  { title: "서비스 상태와 중지된 기능 확인", href: "/operations/system" },
  { title: "입출금 요청과 실제 처리 결과 확인", href: "/deposits/krw" },
  { title: "실패·격리된 작업과 거래 차이 확인", href: "/exceptions" },
  { title: "최근 운영 기록과 후속 안내 확인", href: "/operations/audit" },
] as const;

export function OperatorChecklist() {
  const [checked, setChecked] = useState<string[]>([]);
  useEffect(() => {
    const clear = () => setChecked([]);
    window.addEventListener("offline", clear);
    window.addEventListener("pagehide", clear);
    return () => {
      window.removeEventListener("offline", clear);
      window.removeEventListener("pagehide", clear);
    };
  }, []);
  return (
    <section
      className={styles.panel}
      aria-labelledby="operator-checklist-title"
    >
      <p className="eyebrow">하루 마무리</p>
      <h2 id="operator-checklist-title">내 확인 목록</h2>
      <p className={styles.note}>
        직접 확인한 항목만 표시해요. 체크해도 요청이 처리되거나 서비스 정상으로
        기록되지 않아요.
      </p>
      <ul className={styles.checklist}>
        {tasks.map((task) => (
          <li key={task.title}>
            <label>
              <input
                type="checkbox"
                checked={checked.includes(task.title)}
                onChange={(event) =>
                  setChecked((values) =>
                    event.target.checked
                      ? [...values, task.title]
                      : values.filter((value) => value !== task.title),
                  )
                }
              />
              {task.title}
            </label>
            <Link className="text-link" href={task.href as Route}>
              확인 화면 열기
            </Link>
          </li>
        ))}
      </ul>
      <p role="status" className={styles.note}>
        직접 확인 표시 {checked.length} / {tasks.length} · 이 화면에서만
        유지해요.
      </p>
    </section>
  );
}
