export default function AdminLoading() {
  return (
    <section
      className="queue-empty"
      data-ui-state="loading"
      aria-busy="true"
      role="status"
    >
      <h1>운영 화면을 불러오고 있습니다.</h1>
      <p>권한과 최신 정보를 확인한 뒤 표시합니다.</p>
    </section>
  );
}
