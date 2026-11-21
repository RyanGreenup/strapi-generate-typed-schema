import type { JsonSchema } from "./document.js";

import { isUnknownArray, toRecord } from "./json.js";

interface SchemaVisitor {
  copy: boolean;
  visit: (schema: JsonSchema) => void;
}

const visitMap = (value: unknown, visitor: SchemaVisitor): unknown => {
  const entries = toRecord(value);
  if (visitor.copy) {
    return Object.fromEntries(
      Object.entries(entries).map(([name, child]) => [
        name,
        walkSchema(child, visitor),
      ]),
    );
  }
  for (const child of Object.values(entries)) {
    walkSchema(child, visitor);
  }
  return value;
};

const visitArray = (value: unknown, visitor: SchemaVisitor): unknown => {
  if (isUnknownArray(value)) {
    if (visitor.copy) {
      return value.map((child) => walkSchema(child, visitor));
    }
    for (const child of value) {
      walkSchema(child, visitor);
    }
  }
  return value;
};

const childKeywords: Record<string, "map" | "array" | "schema"> = {
  $defs: "map",
  definitions: "map",
  properties: "map",
  patternProperties: "map",
  dependentSchemas: "map",
  allOf: "array",
  anyOf: "array",
  oneOf: "array",
  prefixItems: "array",
  additionalProperties: "schema",
  unevaluatedProperties: "schema",
  propertyNames: "schema",
  items: "schema",
  unevaluatedItems: "schema",
  contains: "schema",
  not: "schema",
  if: "schema",
  // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema keyword, not a promise method.
  then: "schema",
  else: "schema",
  contentSchema: "schema",
};

// Examples, defaults, enum values, extensions and property names are data.
const visitKeyword = (
  key: string,
  value: unknown,
  visitor: SchemaVisitor,
): unknown => {
  const kind = childKeywords[key];
  if (kind === "map") {
    return visitMap(value, visitor);
  }
  if (kind === "array") {
    return visitArray(value, visitor);
  }
  return kind === "schema" ? walkSchema(value, visitor) : value;
};

/** Visit schema-valued keywords bottom-up; copy only schema nodes for rewrites. */
function walkSchema(
  value: unknown,
  visitor: SchemaVisitor,
): JsonSchema | boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null || typeof value !== "object" || isUnknownArray(value)) {
    throw new TypeError("Expected an object or boolean JSON Schema");
  }
  const schema = toRecord(value);
  const result = visitor.copy ? { ...schema } : schema;
  for (const [key, entry] of Object.entries(schema)) {
    const children = visitKeyword(key, entry, visitor);
    if (children !== entry) {
      result[key] = children;
    }
  }
  visitor.visit(result);
  return result;
}

export { walkSchema };
export type { SchemaVisitor };
