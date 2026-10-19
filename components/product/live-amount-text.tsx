import styles from "./live-amount-text.module.css";

/**
 * Presentation of an already formatted amount. It never parses or computes
 * money. Each character is keyed by its distance from the end, so when the
 * value rises only the digits that changed re-mount and play a short
 * transform/opacity rise; the others stay still and the width never changes.
 */
export function LiveAmountText({
  text,
  animate,
}: {
  text: string;
  animate: boolean;
}) {
  const characters = Array.from(text);
  return (
    <span className={styles.amount} data-live-motion={animate ? "on" : "off"}>
      {characters.map((character, index) => (
        <span
          key={`${characters.length - 1 - index}:${character}`}
          className={/[0-9]/.test(character) ? styles.digit : styles.glyph}
        >
          {character}
        </span>
      ))}
    </span>
  );
}
