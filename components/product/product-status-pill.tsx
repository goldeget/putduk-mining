import styles from "@/components/product/product-experience.module.css";

export type ProductStatusTone =
  "danger" | "info" | "neutral" | "success" | "warning";

const toneClasses: Record<ProductStatusTone, string> = {
  danger: styles.toneDanger ?? "",
  info: styles.toneInfo ?? "",
  neutral: "",
  success: styles.toneSuccess ?? "",
  warning: styles.toneWarning ?? "",
};

export function ProductStatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: ProductStatusTone;
}) {
  return (
    <span className={`${styles.statusPill} ${toneClasses[tone]}`.trim()}>
      {label}
    </span>
  );
}
