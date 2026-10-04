import styles from "./putduk-ai-dock.module.css";

/** The reviewed launcher face is decorative; its button supplies the name. */
export function PutdukAiMascot() {
  return (
    <picture className={styles.mascot}>
      <source
        type="image/avif"
        srcSet="/brand/mascot/putduk-ai-help-face-128-v1.avif 128w, /brand/mascot/putduk-ai-help-face-256-v1.avif 256w"
        sizes="44px"
      />
      <img
        src="/brand/mascot/putduk-ai-help-face-128-v1.webp"
        srcSet="/brand/mascot/putduk-ai-help-face-128-v1.webp 128w, /brand/mascot/putduk-ai-help-face-256-v1.webp 256w"
        sizes="44px"
        width="128"
        height="128"
        alt=""
        decoding="async"
      />
    </picture>
  );
}
