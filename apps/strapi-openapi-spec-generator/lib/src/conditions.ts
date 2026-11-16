import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { ConditionContext } from "./condition-predicates.js";
import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";

import { compilePredicate } from "./condition-predicates.js";
import { listDirectories } from "./content-types.js";
import { parseJsonObject, toRecord } from "./json.js";
import { pascalCase } from "./names.js";
import { shapeOnly } from "./shape-only.js";

type Mode = ConditionContext["mode"];
interface Model {
  uid: string;
  file: string;
}
interface ModelContext extends ConditionContext {
  uid: string;
  warnings: Set<string>;
  schemas: Record<string, JsonSchema>;
  visited: WeakSet<JsonSchema>;
}
interface Field {
  key: string;
  attribute: JsonSchema;
  visible: unknown;
}

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

const relaxed = (
  attribute: JsonSchema,
  original: JsonSchema,
  context: ModelContext,
): JsonSchema => {
  if (context.mode !== "response") {
    return {};
  }
  const { type } = attribute;
  if (type === "enumeration") {
    return { anyOf: [shapeOnly(original, context.schemas), { type: "null" }] };
  }
  if (
    [
      "string",
      "text",
      "richtext",
      "uid",
      "email",
      "password",
      "date",
      "datetime",
      "time",
      "timestamp",
      "biginteger",
    ].includes(String(type))
  ) {
    return { type: ["string", "null"] };
  }
  if (type === "integer") {
    return { type: ["integer", "null"] };
  }
  if (type === "float" || type === "decimal") {
    return { type: ["number", "null"] };
  }
  if (type === "boolean") {
    return { type: ["boolean", "null"] };
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

const variant = (suffix: string): Mode | undefined => {
  if (/^(?:Published|Draft)?(?:Document|Block)$/u.test(suffix)) {
    return "response";
  }
  if (/^(?:Published|Draft)?(?:Create|Update)Input$/u.test(suffix)) {
    return suffix.includes("Update") ? "update" : "create";
  }
  if (
    /^(?:Published|Draft)?(?:Create|Update|Existing|New)?(?:Entry|Block)Input$/u.test(
      suffix,
    )
  ) {
    return suffix.includes("Update") ||
      suffix.includes("Existing") ||
      suffix === "DraftEntryInput"
      ? "update"
      : "create";
  }
  return undefined;
};

const conditionalBranch = (
  schema: JsonSchema,
  field: Field,
  context: ModelContext,
): JsonSchema | undefined => {
  const { key, attribute, visible } = field;
  const properties = toRecord(schema["properties"]);
  const original = toRecord(properties[key]);
  const { required } = schema;
  const wasRequired = isUnknownArray(required) && required.includes(key);
  properties[key] = relaxed(attribute, original, context);
  if (isUnknownArray(required)) {
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
  for (const [key, raw] of Object.entries(context.attributes)) {
    const attribute = toRecord(raw);
    const { visible } = toRecord(attribute["conditions"]);
    if (Boolean(visible) && key in properties) {
      conditions[key] = visible;
      const branch = conditionalBranch(
        schema,
        { key, attribute, visible },
        context,
      );
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

const applyBranches = (
  schema: JsonSchema,
  visit: (branch: JsonSchema) => void,
): void => {
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const entries = schema[keyword];
    if (isUnknownArray(entries)) {
      for (const entry of entries) {
        visit(toRecord(entry));
      }
    }
  }
};
const applyModel = (schema: JsonSchema, context: ModelContext): void => {
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
    context.mode !== "response" &&
    isUnknownArray(required) &&
    required.includes("id")
      ? { ...context, mode: "update" }
      : context;
  applyBranches(schema, (branch) => applyModel(branch, nestedContext));
  applyProperties(schema, nestedContext);
};

const modelMode = (name: string, uid: string): Mode | undefined => {
  const prefix = pascalCase(uid);
  const named = name.startsWith(prefix)
    ? variant(name.slice(prefix.length))
    : undefined;
  // typia preserves multi-argument helpers rather than renaming them. Its
  // OpenAPI names remove generic delimiters and escape UID punctuation.
  const decoded = name
    .replace(/-x[0-9A-F]{16}$/u, "")
    .replaceAll(/_x(?<code>[0-9A-F]{2})_/gu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
  const helper = `EntryInput${uid}`;
  if (!decoded.startsWith(helper)) {
    return named;
  }
  const flags = /^(?:true|false)(?<update>true|false)$/u.exec(
    decoded.slice(helper.length),
  );
  const update = flags?.groups?.["update"];
  if (update === undefined) {
    return named;
  }
  return update === "true" ? "update" : "create";
};

const componentModels = async (root: string): Promise<Model[]> => {
  const categories = await listDirectories(root);
  const groups = await Promise.all(
    categories.map(async (category) => {
      const files = await readdir(path.join(root, category));
      return files
        .filter((file) => file.endsWith(".json"))
        .map((file) => ({
          uid: `${category}.${path.basename(file, ".json")}`,
          file: path.join(root, category, file),
        }));
    }),
  );
  return groups.flat();
};

const applyConditions = async (
  projectDirectory: string,
  contentTypes: ContentType[],
  schemas: Record<string, JsonSchema>,
): Promise<string[]> => {
  const root = path.join(projectDirectory, "src", "components");
  const models: Model[] = [
    ...contentTypes.map((contentType) => {
      const name = contentType.uid.slice(contentType.uid.lastIndexOf(".") + 1);
      return {
        uid: contentType.uid,
        file: path.join(
          projectDirectory,
          "src",
          "api",
          contentType.apiName,
          "content-types",
          name,
          "schema.json",
        ),
      };
    }),
    ...(await componentModels(root)),
  ];
  const definitions = await Promise.all(
    models.map(async (model) => {
      const source = await readFile(model.file, "utf8");
      return {
        model,
        attributes: toRecord(parseJsonObject(source)["attributes"]),
      };
    }),
  );
  const warnings = new Set<string>();
  for (const { model, attributes } of definitions) {
    const visited = new WeakSet<JsonSchema>();
    for (const [name, schema] of Object.entries(schemas)) {
      const mode = modelMode(name, model.uid);
      if (mode !== undefined) {
        applyModel(schema, {
          attributes,
          mode,
          uid: model.uid,
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
