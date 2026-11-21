type UnknownRecord = Record<string, unknown>;

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toRecord = (value: unknown): UnknownRecord =>
  isRecord(value) ? value : {};

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const parseJsonObject = (text: string): UnknownRecord =>
  toRecord(JSON.parse(text));

export { isUnknownArray, parseJsonObject, toOptionalString, toRecord };
