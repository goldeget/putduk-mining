/** Self-contained for Locator.evaluateAll; observes every global match. */
export function snapshotUniqueVisibleInput(elements: Element[]) {
  const count = elements.length;
  if (count !== 1) return { count, visible: false };
  const input = elements[0]!;
  if (
    !input.checkVisibility() ||
    getComputedStyle(input).visibility !== "visible"
  ) {
    return { count, visible: false };
  }
  const rect = input.getBoundingClientRect();
  return { count, visible: rect.width > 0 && rect.height > 0 };
}
