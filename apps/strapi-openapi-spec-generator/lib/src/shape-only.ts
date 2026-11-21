import type { JsonSchema } from "./document.js";

import { isUnknownArray, toRecord } from "./json.js";
import { schemaRef, schemaRefName } from "./schema-names.js";

const isIdentity = (key: unknown): boolean =>
  key === "id" || key === "documentId" || key === "__component";

/** Preserve serialized structure without asserting validation of hidden values. */
function shapeOnly(
  value: unknown,
  schemas: Record<string, JsonSchema>,
): JsonSchema {
  const schema = toRecord(value);
  const { $ref: reference } = schema;
  const name =
    typeof reference === "string" ? schemaRefName(reference) : undefined;
  if (name !== undefined) {
    const source = schemas[name];
    if (source === undefined) {
      return { $ref: reference };
    }
    const alias = `${name}Unvalidated`;
    if (!(alias in schemas)) {
      // Reserve the alias before descending into a recursive model.
      schemas[alias] = {};
      schemas[alias] = shapeOnly(source, schemas);
    }
    return { $ref: schemaRef(alias) };
  }
  return inlineShape(schema, schemas);
}

function inlineShape(
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>,
): JsonSchema {
  const { type, properties, items, required } = schema;
  const result: JsonSchema = {};
  if (type !== undefined) {
    result["type"] = type;
  }
  if ("const" in schema) {
    // oxlint-disable-next-line unicorn/no-null -- JSON literal null has its own schema type.
    result["type"] = schema["const"] === null ? "null" : typeof schema["const"];
  }
  if (properties !== undefined) {
    result["properties"] = Object.fromEntries(
      Object.entries(toRecord(properties)).map(([key, entry]) => [
        key,
        isIdentity(key)
          ? entry
          : { anyOf: [shapeOnly(entry, schemas), { type: "null" }] },
      ]),
    );
    result["additionalProperties"] = schema["additionalProperties"] ?? true;
  }
  if (isUnknownArray(required)) {
    result["required"] = required.filter((key) => isIdentity(key));
  }
  if (items !== undefined) {
    result["items"] = shapeOnly(items, schemas);
  }
  const variants = schema["anyOf"] ?? schema["oneOf"];
  if (isUnknownArray(variants)) {
    result["anyOf"] = variants.map((entry) => shapeOnly(entry, schemas));
  }
  return result;
}

export { shapeOnly };
