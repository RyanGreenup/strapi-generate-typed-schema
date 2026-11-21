import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { ConditionContext } from "./condition-predicates.js";
import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";

import { compilePredicate } from "./condition-predicates.js";
import { listDirectories } from "./content-types.js";
import { isUnknownArray, parseJsonObject, toRecord } from "./json.js";
import { pascalCase } from "./names.js";
import { CONDITION_MODES } from "./schema-names.js";
import { shapeOnly } from "./shape-only.js";

type Mode = ConditionContext["mode"];
type Model = Pick<ContentType, "attributes" | "uid">;
interface ModelContext extends ConditionContext {
  uid: string;
  fields: Field[];
  warnings: Set<string>;
  schemas: Record<string, JsonSchema>;
  visited: WeakSet<JsonSchema>;
}
interface Field {
  key: string;
  type: unknown;
  visible: unknown;
}

const STRING_TYPES: Record<string, true> = {
  string: true,
  text: true,
  richtext: true,
  uid: true,
  email: true,
  password: true,
  date: true,
  datetime: true,
  time: true,
  timestamp: true,
  biginteger: true,
};

const relaxed = (
  type: unknown,
  original: JsonSchema,
  context: ModelContext,
): JsonSchema => {
  if (context.mode !== "response") {
    return {};
  }
  if (type === "enumeration") {
    return { anyOf: [shapeOnly(original, context.schemas), { type: "null" }] };
  }
  if (STRING_TYPES[String(type)] === true) {
    return { type: ["string", "null"] };
  }
  if (type === "integer" || type === "boolean") {
    return { type: [type, "null"] };
  }
  if (type === "float" || type === "decimal") {
    return { type: ["number", "null"] };
  }
  if (Object.keys(original).length === 0) {
    return {};
  }
  // Hidden structured values keep their shape but not their published rules:
  // the original still types the field, and its draft form accepts stale values.
  return {
    anyOf: [original, shapeOnly(original, context.schemas), { type: "null" }],
  };
};

const variant = (name: string, prefix: string): Mode | undefined =>
  name.startsWith(prefix)
    ? CONDITION_MODES.get(name.slice(prefix.length))
    : undefined;

const conditionalBranch = (
  schema: JsonSchema,
  field: Field,
  context: ModelContext,
): JsonSchema | undefined => {
  const { key, type, visible } = field;
  const properties = toRecord(schema["properties"]);
  const original = toRecord(properties[key]);
  const { required } = schema;
  const wasRequired = isUnknownArray(required) && required.includes(key);
  properties[key] = relaxed(type, original, context);
  if (wasRequired) {
    schema["required"] = required.filter((entry) => entry !== key);
  }
  const truth = compilePredicate(visible, context);
  if (truth === undefined) {
    context.warnings.add(
      `${context.uid}.${key}: unsupported conditions.visible; validation is conservatively relaxed and the rule is retained in x-strapi-conditions`,
    );
    return undefined;
  }
  const consequent: JsonSchema = { properties: { [key]: original } };
  if (wasRequired) {
    consequent["required"] = [key];
  }
  // oxlint-disable-next-line unicorn/no-thenable -- `then` is a JSON Schema keyword, not a promise method.
  return { if: truth.yes, then: consequent };
};

const applyProperties = (schema: JsonSchema, context: ModelContext): void => {
  const properties = toRecord(schema["properties"]);
  const conditions: JsonSchema = {};
  const branches: JsonSchema[] = [];
  for (const field of context.fields) {
    if (field.key in properties) {
      conditions[field.key] = field.visible;
      const branch = conditionalBranch(schema, field, context);
      if (branch !== undefined) {
        branches.push(branch);
      }
    }
  }
  if (Object.keys(conditions).length > 0) {
    schema["x-strapi-conditions"] = conditions;
    const { allOf } = schema;
    schema["allOf"] = [...(isUnknownArray(allOf) ? allOf : []), ...branches];
  }
};

const applyBranches = (schema: JsonSchema, context: ModelContext): void => {
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const entries = schema[keyword];
    if (isUnknownArray(entries)) {
      for (const entry of entries) {
        applyModel(toRecord(entry), context);
      }
    }
  }
};
function applyModel(schema: JsonSchema, context: ModelContext): void {
  if (context.visited.has(schema)) {
    return;
  }
  context.visited.add(schema);
  const { $ref: reference, required } = schema;
  const prefix = "#/components/schemas/";
  if (typeof reference === "string" && reference.startsWith(prefix)) {
    const target = context.schemas[reference.slice(prefix.length)];
    if (target !== undefined) {
      applyModel(target, context);
    }
    return;
  }
  const nestedContext: ModelContext =
    context.mode === "create" &&
    isUnknownArray(required) &&
    required.includes("id")
      ? { ...context, mode: "update" }
      : context;
  applyBranches(schema, nestedContext);
  applyProperties(schema, nestedContext);
}

// Typia encodes multi-argument EntryInput helpers as a UID and two boolean flags.
const entryHelper = (name: string): { uid: string; mode: Mode } | undefined => {
  const decoded = name
    .replace(/-x[0-9A-F]{16}$/u, "")
    .replaceAll(/_x(?<code>[0-9A-F]{2})_/gu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
  const flags =
    /^EntryInput(?<uid>.*)(?:true|false)(?<update>true|false)$/su.exec(
      decoded,
    )?.groups;
  const uid = flags?.["uid"];
  return uid === undefined
    ? undefined
    : { uid, mode: flags?.["update"] === "true" ? "update" : "create" };
};

const componentModels = async (root: string): Promise<Model[]> => {
  const categories = await listDirectories(root);
  const groups = await Promise.all(
    categories.map(async (category) => {
      const directory = path.join(root, category);
      const files = await readdir(directory);
      return Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => {
            const source = await readFile(path.join(directory, file), "utf8");
            return {
              uid: `${category}.${path.basename(file, ".json")}`,
              attributes: toRecord(parseJsonObject(source)["attributes"]),
            };
          }),
      );
    }),
  );
  return groups.flat();
};

function* conditionalModels(
  models: Model[],
): Generator<Model & { fields: Field[] }> {
  for (const { uid, attributes } of models) {
    const fields: Field[] = [];
    for (const [key, raw] of Object.entries(attributes)) {
      const attribute = toRecord(raw);
      const { visible } = toRecord(attribute["conditions"]);
      const hasCondition = Boolean(visible);
      if (hasCondition) {
        fields.push({ key, type: attribute["type"], visible });
      }
    }
    if (fields.length > 0) {
      yield { uid, attributes, fields };
    }
  }
}

/** Apply source visibility rules to model schemas in place and return warnings in model order. */
const applyConditions = async (
  projectDirectory: string,
  contentTypes: ContentType[],
  schemas: Record<string, JsonSchema>,
): Promise<string[]> => {
  const root = path.join(projectDirectory, "src", "components");
  const models = [...contentTypes, ...(await componentModels(root))];
  // shapeOnly adds Unvalidated aliases, which are not model entry points.
  const entries = Object.entries(schemas).map(([name, schema]) => ({
    name,
    schema,
    helper: entryHelper(name),
  }));
  const warnings = new Set<string>();
  for (const { uid, attributes, fields } of conditionalModels(models)) {
    const prefix = pascalCase(uid);
    const visited = new WeakSet<JsonSchema>();
    for (const { name, schema, helper } of entries) {
      const mode = helper?.uid === uid ? helper.mode : variant(name, prefix);
      if (mode !== undefined) {
        applyModel(schema, {
          attributes,
          mode,
          uid,
          fields,
          warnings,
          schemas,
          visited,
        });
      }
    }
  }
  return [...warnings];
};

export { applyConditions };
