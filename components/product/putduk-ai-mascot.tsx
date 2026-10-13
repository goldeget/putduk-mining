import styles from "./putduk-ai-dock.module.css";

/** The current canonical emblem is decorative; its button supplies the name. */
export function PutdukAiMascot() {
  return (
    <picture className={styles.mascot}>
      <img
        src="/brand/identity/20261013/logo/putduk-ai-symbol.svg"
        data-putduk-brand="canonical"
        data-putduk-brand-version="2026.10.13-sprout-p-v1"
        sizes="44px"
        width="128"
        height="128"
        alt=""
        decoding="async"
      />
    </picture>
  );
}
