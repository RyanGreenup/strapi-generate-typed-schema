/** A JSON object whose values are not yet checked. */
type UnknownRecord = Record<string, unknown>;

/**
 * Test for a plain object.
 *
 * @param value - Any value.
 * @returns True when `value` is an object and not an array.
 */
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Narrow a value to an object.
 *
 * @param value - Any value.
 * @returns The object, or an empty object when `value` is something else.
 */
const toRecord = (value: unknown): UnknownRecord =>
  isRecord(value) ? value : {};

/**
 * Narrow a value to a string.
 *
 * @param value - Any value.
 * @returns The string, or `undefined` when `value` is something else.
 */
const toOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * Parse JSON text that holds an object.
 *
 * @param text - The JSON text.
 * @returns The object, or an empty object when the text holds another kind of value.
 */
const parseJsonObject = (text: string): UnknownRecord => {
  const value: unknown = JSON.parse(text);

  return toRecord(value);
};

export { isRecord, parseJsonObject, toOptionalString, toRecord };
export type { UnknownRecord };
