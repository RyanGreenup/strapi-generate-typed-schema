import type { WriteRegex } from "./attribute-regex.js";
import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";
import type { SchemaRoot } from "./schema-identity.js";

import { applyWriteRegex, writeRegex } from "./attribute-regex.js";
import { isUnknownArray, toRecord } from "./json.js";
import { schemaRefName } from "./schema-names.js";
import { walkSchema } from "./schema-traversal.js";

type Model = Pick<ContentType, "uid" | "attributes">;

const annotations = (attribute: JsonSchema, input: boolean): JsonSchema => {
  const result: JsonSchema = {};
  if (Object.hasOwn(attribute, "default"))
    result["default"] = attribute["default"];
  if (attribute["unique"] === true) result["x-strapi-unique"] = true;
  const { type, allowedTypes, min, max } = attribute;
  if (type === "media" && isUnknownArray(allowedTypes)) {
    result["x-strapi-allowed-types"] = allowedTypes;
  }
  if (input && (type === "integer" || type === "float" || type === "decimal")) {
    result["x-strapi-coerces-numeric-string"] = true;
    if (typeof min === "number" || typeof max === "number") {
      result["x-strapi-post-coercion-bounds"] = {
        ...(typeof min === "number" && { minimum: min }),
        ...(typeof max === "number" && { maximum: max }),
      };
    }
  }
  return result;
};

// These branches describe the same model instance. Do not enter property values
// (relations and nested components have their own owners), predicates or examples.
const visitOwner = (
  node: JsonSchema,
  visit: (schema: JsonSchema) => void,
): void => {
  visit(node);
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    const branches = node[key];
    if (isUnknownArray(branches)) {
      for (const child of branches) visitOwner(toRecord(child), visit);
    }
  }
  if (node["then"] !== undefined) visitOwner(toRecord(node["then"]), visit);
};

const applyAttributeMetadata = (
  models: Model[],
  roots: SchemaRoot[],
  schemas: Record<string, JsonSchema>,
): string[] => {
  const warnings = new Set<string>();
  const owners = new Map(roots.map((root) => [root.name, root]));
  const sources = new Map(models.map((model) => [model.uid, model.attributes]));
  const rulesForModel = new Map<string, Map<string, WriteRegex>>();
  for (const { uid, attributes } of models) {
    const rules = new Map<string, WriteRegex>();
    for (const [field, raw] of Object.entries(attributes)) {
      const rule = writeRegex(toRecord(raw));
      if (rule) rules.set(field, rule);
    }
    if (rules.size) rulesForModel.set(uid, rules);
  }
  // Isolate aliases shared across owners or input/response roles before any
  // canonical property is annotated. Same-owner named targets get their own pass.
  const detached: [JsonSchema, JsonSchema][] = [];
  for (const root of roots) {
    const schema = schemas[root.name];
    if (!schema || !root.mode) continue;
    const seen = new Set<string>([root.name]);
    const isolate = (node: JsonSchema): void => {
      const ref = node["$ref"];
      const name = typeof ref === "string" ? schemaRefName(ref) : undefined;
      if (!name || seen.has(name)) return;
      const owner = owners.get(name);
      if (
        owner?.mode &&
        owner.uid === root.uid &&
        (owner.mode === "response") === (root.mode === "response") &&
        (owner.publishedInput === root.publishedInput ||
          !root.uid ||
          !rulesForModel.has(root.uid))
      )
        return;
      const target = schemas[name];
      if (!target) return;
      seen.add(name);
      const copy = toRecord(
        walkSchema(target, { copy: true, visit: () => {} }),
      );
      visitOwner(copy, isolate);
      seen.delete(name);
      detached.push([node, copy]);
    };
    visitOwner(schema, isolate);
  }
  for (const [node, copy] of detached) {
    Reflect.deleteProperty(node, "$ref");
    node["allOf"] = [
      ...(isUnknownArray(node["allOf"]) ? node["allOf"] : []),
      copy,
    ];
  }
  for (const { uid, name, mode, publishedInput } of roots) {
    const attributes = uid && sources.get(uid);
    const schema = schemas[name];
    if (!attributes || !mode || !schema) continue;
    visitOwner(schema, (node) => {
      const properties = toRecord(node["properties"]);
      for (const [field, child] of Object.entries(properties)) {
        if (!Object.hasOwn(attributes, field)) continue;
        const meta = annotations(
          toRecord(attributes[field]),
          mode !== "response",
        );
        const rule =
          publishedInput && uid
            ? rulesForModel.get(uid)?.get(field)
            : undefined;
        if (!rule && Object.keys(meta).length === 0) continue;
        const property = child === false ? { not: {} } : toRecord(child);
        if (rule && !rule.portable) {
          warnings.add(
            `${uid}.${field}: source regex is outside the supported Unicode-equivalent subset; retained in x-strapi-regex without enforcing it`,
          );
        }
        properties[field] = {
          ...(rule ? applyWriteRegex(property, rule) : property),
          ...meta,
        };
      }
    });
  }
  return [...warnings];
};

export { applyAttributeMetadata };
