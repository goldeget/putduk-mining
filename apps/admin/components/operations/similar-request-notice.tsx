export function SimilarRequestNotice({ count }: { count: number | undefined }) {
  if (!count || count < 2) return null;
  return (
    <aside className="queue-flash" role="note">
      <strong>같은 회원·금액의 대기 신청 {count}건</strong>
      <p>
        현재 표시된 목록에서 찾았어요. 실제 중복 이체라는 뜻은 아니에요. 다른
        신청과 증빙을 대조한 뒤 처리해 주세요.
      </p>
    </aside>
  );
}
