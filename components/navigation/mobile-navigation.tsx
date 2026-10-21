import {
  PutdukIcon,
  type PutdukIconName,
} from "@/components/icons/putduk-icon";

/** Design example aligned with SIMPLIFIED_TRACK bottom nav (no 상품/이벤트/AI). */
const items: ReadonlyArray<{ icon: PutdukIconName; label: string }> = [
  { icon: "home", label: "홈" },
  { icon: "mining", label: "채굴" },
  { icon: "wallet", label: "지갑" },
  { icon: "menu", label: "더보기" },
];

export function MobileNavigation() {
  return (
    <nav className="mobile-navigation" aria-label="주요 메뉴 디자인 예시">
      {items.map((item, index) => (
        <button
          type="button"
          className={index === 0 ? "is-active" : undefined}
          aria-current={index === 0 ? "page" : undefined}
          key={item.label}
        >
          <PutdukIcon name={item.icon} size={21} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
