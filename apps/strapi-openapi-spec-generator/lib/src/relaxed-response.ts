import type { JsonSchema } from "./document.js";

import { toRecord } from "./json.js";

const REFERENCE_PREFIX = "#/components/schemas/";
const IDENTITY_KEYS = new Set(["id", "documentId", "__component"]);

const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});

/** Copy a reference once, retaining recursive structure but not entity validation. */
const relaxedReference = (
  reference: string,
  schemas: Record<string, JsonSchema>,
): JsonSchema => {
  const name = reference.slice(REFERENCE_PREFIX.length);
  const relaxedName = `${name}Unvalidated`;
  const source = schemas[name];
  if (source === undefined) {
    return { $ref: reference };
  }
  if (!(relaxedName in schemas)) {
    // Reserve the name before descending into recursive component/relation graphs.
    schemas[relaxedName] = {};
    Object.assign(schemas[relaxedName], relaxResponse(source, schemas));
  }
  return { $ref: `${REFERENCE_PREFIX}${relaxedName}` };
};

const relaxedProperties = (
  properties: JsonSchema,
  schemas: Record<string, JsonSchema>,
): JsonSchema =>
  Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      IDENTITY_KEYS.has(key)
        ? value
        : nullable(relaxResponse(toRecord(value), schemas)),
    ]),
  );

/** Keep primitive and container shapes; remove bounds, formats and presence rules. */
const relaxResponse = (
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>,
): JsonSchema => {
  const { $ref: reference, type, properties, items, required } = schema;
  if (typeof reference === "string" && reference.startsWith(REFERENCE_PREFIX)) {
    return relaxedReference(reference, schemas);
  }
  const result: JsonSchema = {};
  if (type !== undefined) {
    result["type"] = type;
  }
  if ("const" in schema) {
    result["type"] = schema["const"] === null ? "null" : typeof schema["const"];
  }
  if (properties !== undefined) {
    result["properties"] = relaxedProperties(toRecord(properties), schemas);
    result["additionalProperties"] = schema["additionalProperties"] ?? true;
  }
  if (Array.isArray(required)) {
    result["required"] = required.filter(
      (key: unknown) => typeof key === "string" && IDENTITY_KEYS.has(key),
    );
  }
  if (items !== undefined) {
    result["items"] = relaxResponse(toRecord(items), schemas);
  }
  const variants = schema["anyOf"] ?? schema["oneOf"];
  if (Array.isArray(variants)) {
    result["anyOf"] = variants.map((entry: unknown) =>
      relaxResponse(toRecord(entry), schemas),
    );
  }
  return result;
};

/** Retain public model references and a structurally typed, unvalidated alternative. */
const relaxedStructuredResponse = (
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>,
): JsonSchema => ({
  anyOf: [schema, nullable(relaxResponse(schema, schemas))],
});

export { relaxedStructuredResponse };
