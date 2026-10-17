import Link from "next/link";
import { PutdukAiChat } from "@/components/product/putduk-ai-chat";
import { requirePageUser } from "@/lib/auth/session";
import { readMemberScreenFacts } from "@/lib/product/member-screen-facts";
import { formatScreenKrw } from "@/lib/product/member-screen-present";
import styles from "./page.module.css";

export default async function PutdukAiPage() {
  const identity = await requirePageUser("/menu/ai");
  const facts = await readMemberScreenFacts(identity);
  return (
    <section className={styles.page} data-ai-page>
      <PutdukAiChat
        presentation="page"
        surface="page"
        pageFacts={{
          ownerUserId: identity.userId,
          displayName: facts.displayName,
          rankName: facts.rankName,
          availableKrwLabel:
            facts.availableKrwAtomic === null ||
            !/^-?\d+$/.test(facts.availableKrwAtomic)
              ? "확인할 수 없음"
              : formatScreenKrw(
                  facts.availableKrwAtomic,
                  facts.walletUnavailable,
                ).replace(/ KRW$/, "원"),
        }}
        pageTools={
          <>
            <details className={styles.principles}>
              <summary>답변 범위</summary>
              <div>
                <p>내 기록과 퍼뜩 이용 안내를 확인해요.</p>
                <p>송금·승인·잔액 변경은 퍼뜩 AI가 직접 실행하지 않아요.</p>
                <p>확인할 수 없는 내용은 추측하지 않아요.</p>
              </div>
            </details>
            <Link
              className={styles.close}
              href="/menu"
              aria-label="AI 화면 닫기"
            >
              닫기
            </Link>
          </>
        }
      />
    </section>
  );
}
