/* Text truncation helpers adapted from @opencode-ai/tui (MIT licensed,
 * github.com/anomalyco/opencode), packages/tui/src/util/locale.ts#L61-L79.
 * Kept: truncate, truncateLeft, truncateMiddle.
 * Dropped: titlecase/time/datetime/number/duration/pluralize helpers and
 * the `export * as Locale` namespace re-export (import the functions
 * directly).
 * Added: ASCII "..." ellipsis instead of the single-character one, with the
 * length arithmetic adjusted to its width of 3.
 */

const ELLIPSIS = "...";

/** Replaces the right end with ASCII dots when the UTF-16 length exceeds `len`. */
export function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, Math.max(0, len - ELLIPSIS.length)) + ELLIPSIS;
}

/** Replaces the left end with ASCII dots when the UTF-16 length exceeds `len`. */
export function truncateLeft(str: string, len: number): string {
  if (str.length <= len) return str;
  return ELLIPSIS + str.slice(-Math.max(0, len - ELLIPSIS.length));
}

/** Keeps both ends around ASCII dots, with any extra retained UTF-16 unit at the start. */
export function truncateMiddle(str: string, maxLength = 35): string {
  if (str.length <= maxLength) return str;

  const keepStart = Math.ceil((maxLength - ELLIPSIS.length) / 2);
  const keepEnd = Math.floor((maxLength - ELLIPSIS.length) / 2);

  return str.slice(0, keepStart) + ELLIPSIS + str.slice(-keepEnd);
}
