import type { JsonSchema } from "./document.js";

import { toRecord } from "./json.js";

const SCHEMAS = "#/components/schemas/";
const IDENTITY: Record<string, true> = {
  id: true,
  documentId: true,
  __component: true,
};

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

/** Reserve recursive aliases before removing their entity validation rules. */
const referenceShape = (
  reference: string,
  schemas: Record<string, JsonSchema>,
  descend: (schema: JsonSchema) => JsonSchema,
): JsonSchema => {
  const name = reference.slice(SCHEMAS.length);
  const alias = `${name}Unvalidated`;
  const source = schemas[name];
  if (source === undefined) {
    return { $ref: reference };
  }
  if (!(alias in schemas)) {
    schemas[alias] = {};
    Object.assign(schemas[alias], descend(source));
  }
  return { $ref: `${SCHEMAS}${alias}` };
};

const propertyShapes = (
  properties: JsonSchema,
  descend: (schema: JsonSchema) => JsonSchema,
): JsonSchema =>
  Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      IDENTITY[key] === true
        ? value
        : { anyOf: [descend(toRecord(value)), { type: "null" }] },
    ]),
  );

/** Preserve serialized structure without asserting validation of hidden values. */
const shapeOnly = (
  value: unknown,
  schemas: Record<string, JsonSchema>,
): JsonSchema => {
  const schema = toRecord(value);
  const { $ref: reference, type, properties, items, required } = schema;
  if (typeof reference === "string" && reference.startsWith(SCHEMAS)) {
    return referenceShape(reference, schemas, (source) =>
      shapeOnly(source, schemas),
    );
  }
  const result: JsonSchema = {};
  if (type !== undefined) {
    result["type"] = type;
  }
  if ("const" in schema) {
    // oxlint-disable-next-line unicorn/no-null -- JSON literal null has its own schema type.
    result["type"] = schema["const"] === null ? "null" : typeof schema["const"];
  }
  if (properties !== undefined) {
    result["properties"] = propertyShapes(toRecord(properties), (entry) =>
      shapeOnly(entry, schemas),
    );
    result["additionalProperties"] = schema["additionalProperties"] ?? true;
  }
  if (isUnknownArray(required)) {
    result["required"] = required.filter(
      (key) => typeof key === "string" && IDENTITY[key] === true,
    );
  }
  if (items !== undefined) {
    result["items"] = shapeOnly(items, schemas);
  }
  const variants = schema["anyOf"] ?? schema["oneOf"];
  if (isUnknownArray(variants)) {
    result["anyOf"] = variants.map((entry) => shapeOnly(entry, schemas));
  }
  return result;
};

export { shapeOnly };
