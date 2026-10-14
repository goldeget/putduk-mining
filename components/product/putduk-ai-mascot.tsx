import { BrandMark } from "@/components/brand/brand-mark";
import styles from "./putduk-ai-dock.module.css";

/** The current canonical emblem is decorative; its button supplies the name. */
export function PutdukAiMascot() {
  return (
    <span className={styles.mascot} aria-hidden="true">
      <BrandMark title="" width="100%" height="100%" />
    </span>
  );
}
