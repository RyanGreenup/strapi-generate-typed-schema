import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";
import type { SchemaRoot } from "./schema-identity.js";

import { isUnknownArray, toRecord } from "./json.js";
import { schemaRefName } from "./schema-names.js";

type Model = Pick<ContentType, "attributes" | "uid">;

// Strapi metadata that the generated declarations drop, but a client needs to
// tell an owning relation from its inverse or to read per-field intent.
const KEYS = ["relation", "target", "mappedBy", "inversedBy"] as const;

const relationMeta = (attribute: JsonSchema): JsonSchema => {
  const meta: JsonSchema = {};
  for (const key of KEYS) {
    if (attribute[key] !== undefined) {
      meta[key] = attribute[key];
    }
  }
  const pluginOptions = toRecord(attribute["pluginOptions"]);
  if (Object.keys(pluginOptions).length > 0) {
    meta["pluginOptions"] = pluginOptions;
  }
  return meta;
};

const relationMetadata = (attributes: Record<string, unknown>): JsonSchema =>
  Object.fromEntries(
    Object.entries(attributes)
      .map(([field, raw]) => [field, toRecord(raw)] as const)
      .filter(([, attribute]) => attribute["type"] === "relation")
      .map(([field, attribute]) => [field, relationMeta(attribute)]),
  );

const branchesOf = (schema: JsonSchema): unknown[] =>
  ["allOf", "anyOf", "oneOf"].flatMap((keyword) => {
    const branches = schema[keyword];
    return isUnknownArray(branches) ? branches : [];
  });

// Private relations are absent from responses, so list only emitted fields.
const setRelations = (schema: JsonSchema, relations: JsonSchema): void => {
  const properties = toRecord(schema["properties"]);
  const present = Object.entries(relations).filter(([field]) =>
    Object.hasOwn(properties, field),
  );
  if (present.length > 0) {
    schema["x-strapi-relations"] = Object.fromEntries(present);
  }
};

interface ResponseSchemas {
  roots: SchemaRoot[];
  schemas: Record<string, JsonSchema>;
}

/** Visit a model's concrete response objects, but not their nested property schemas. */
const visitResponseObjects = (
  uid: string,
  { roots, schemas }: ResponseSchemas,
  visit: (schema: JsonSchema) => void,
): void => {
  const seen = new WeakSet<JsonSchema>();
  const walk = (schema: JsonSchema): void => {
    if (seen.has(schema)) {
      return;
    }
    seen.add(schema);
    const { $ref: reference } = schema;
    const target =
      typeof reference === "string" ? schemaRefName(reference) : undefined;
    if (target !== undefined && schemas[target] !== undefined) {
      walk(schemas[target]);
    }
    for (const branch of branchesOf(schema)) {
      walk(toRecord(branch));
    }
    if (schema["properties"] !== undefined) {
      visit(schema);
    }
  };
  for (const root of roots) {
    if (root.uid === uid && root.mode === "response") {
      const schema = schemas[root.name];
      if (schema !== undefined) {
        walk(schema);
      }
    }
  }
};

/**
 * Copy source relation metadata onto response schemas as `x-strapi-relations`.
 *
 * The map is keyed by field and holds `relation`, `target`, `mappedBy`,
 * `inversedBy` and non-empty `pluginOptions` as written in the model JSON. It is
 * schema-level because conditions can rewrite a property node into a union.
 * @param models - Content types, components and plugin extensions with source attributes.
 * @param roots - Compiler roots; only response roots of each model are annotated.
 * @param schemas - Named schemas, changed in place.
 */
const applyRelations = (
  models: Model[],
  roots: SchemaRoot[],
  schemas: Record<string, JsonSchema>,
): void => {
  const responseSchemas = { roots, schemas };
  for (const { uid, attributes } of models) {
    const relations = relationMetadata(attributes);
    if (Object.keys(relations).length > 0) {
      visitResponseObjects(uid, responseSchemas, (schema) => {
        setRelations(schema, relations);
      });
    }
  }
};

export { applyRelations, visitResponseObjects };
