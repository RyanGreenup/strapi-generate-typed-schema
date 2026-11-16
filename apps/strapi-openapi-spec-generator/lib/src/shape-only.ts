import type { JsonSchema } from "./document.js";

const SCHEMAS = "#/components/schemas/";
const BOUNDS = new Set([
  "required",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "format",
  "pattern",
]);

/** Drop bounds and point published refs at their draft schemas. */
const shapeOnly = (
  value: unknown,
  schemas: Record<string, JsonSchema>,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => shapeOnly(entry, schemas));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const result: JsonSchema = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") {
      const draft = entry.replace(/Published(?=Document$|Block$)/u, "Draft");
      result[key] = draft.slice(SCHEMAS.length) in schemas ? draft : entry;
    } else if (!BOUNDS.has(key)) {
      result[key] = shapeOnly(entry, schemas);
    }
  }
  return result;
};

export { shapeOnly };
