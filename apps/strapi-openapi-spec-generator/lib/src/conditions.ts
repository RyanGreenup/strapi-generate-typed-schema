import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";

import { listDirectories } from "./content-types.js";
import { parseJsonObject, toRecord } from "./json.js";
import { pascalCase } from "./names.js";

/* oxlint-disable unicorn/no-null -- JSONlogic represents missing variables as null. */
type Predicate = boolean | JsonSchema;
interface Truth {
  yes: Predicate;
  no: Predicate;
}
interface Context {
  attributes: JsonSchema;
  mode: "create" | "update" | "response";
}

const all = (rules: Predicate[]): Predicate => ({ allOf: rules });
const any = (rules: Predicate[]): Predicate => ({ anyOf: rules });
const negate = (rule: Predicate): Predicate => ({ not: rule });
const owns = (key: string): JsonSchema => ({ required: [key] });
const scalar = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

// Missing response discriminators are unknown: fields/populate may have omitted them.
// Create sees schema defaults; update sees only the written data, not stored values.
const atom = (
  key: string,
  match: Predicate,
  test: (value: unknown) => boolean,
  context: Context,
): Truth => {
  const present = all([owns(key), { properties: { [key]: match } }]);
  const absent = negate(owns(key));
  const no = all([owns(key), { properties: { [key]: negate(match) } }]);
  if (context.mode === "response") {
    return { yes: present, no };
  }
  const attribute = toRecord(context.attributes[key]);
  const missing =
    context.mode === "create" && "default" in attribute
      ? attribute["default"]
      : null;
  return test(missing)
    ? { yes: any([present, absent]), no }
    : { yes: present, no: any([no, absent]) };
};

const variable = (value: unknown, context: Context): string | undefined => {
  const record = toRecord(value);
  const key = record["var"];
  return Object.keys(record).length === 1 &&
    typeof key === "string" &&
    key in context.attributes
    ? key
    : undefined;
};

const compile = (rule: unknown, context: Context): Truth | undefined => {
  if (typeof rule === "boolean") {
    return { yes: rule, no: !rule };
  }
  const entries = Object.entries(toRecord(rule));
  if (entries.length !== 1) {
    return undefined;
  }
  const [operator, raw] = entries[0]!;
  const args: unknown[] = Array.isArray(raw) ? raw : [raw];
  if (operator === "and" || operator === "or") {
    if (args.length === 0) {
      return undefined;
    }
    const terms = args.map((arg) => compile(arg, context));
    if (terms.some((term) => term === undefined)) {
      return undefined;
    }
    const known = terms as Truth[];
    return operator === "and"
      ? {
          yes: all(known.map((term) => term.yes)),
          no: any(known.map((term) => term.no)),
        }
      : {
          yes: any(known.map((term) => term.yes)),
          no: all(known.map((term) => term.no)),
        };
  }
  if (operator === "!" && args.length === 1) {
    const term = compile(args[0], context);
    return term === undefined ? undefined : { yes: term.no, no: term.yes };
  }
  if (args.length !== 2) {
    return undefined;
  }
  let key = variable(args[0], context);
  let value = args[1];
  if (key === undefined && operator !== "in") {
    key = variable(args[1], context);
    value = args[0];
  }
  if (key === undefined) {
    return undefined;
  }
  if (operator === "in") {
    if (!Array.isArray(value) || !value.every(scalar)) {
      return undefined;
    }
    return atom(
      key,
      value.length === 0 ? false : { enum: value },
      (entry) => value.includes(entry),
      context,
    );
  }
  if (!["==", "!=", "===", "!=="].includes(operator) || !scalar(value)) {
    return undefined;
  }
  const attribute = toRecord(context.attributes[key]);
  const loose = operator === "==" || operator === "!=";
  // JSONlogic's == coerces primitive operands. Compile a finite enum exactly;
  // for open domains accept only comparisons whose coercions remain representable.
  const equal = (entry: unknown): boolean => {
    if (!loose) {
      return entry === value;
    }
    if (entry === null || value === null) {
      return entry === value;
    }
    if (typeof entry === typeof value) {
      return entry === value;
    }
    return scalar(entry) && Number(entry) === Number(value);
  };
  let match: Predicate = { const: value };
  if (loose && Array.isArray(attribute["enum"])) {
    match = { enum: [...attribute["enum"], null].filter(equal) };
    if ((match["enum"] as unknown[]).length === 0) {
      match = false;
    }
  } else if (loose && value !== null) {
    const type = attribute["type"];
    if (type === "boolean") {
      const values = [true, false].filter(equal);
      match = values.length === 0 ? false : { enum: values };
    } else if (["integer", "float", "decimal"].includes(String(type))) {
      const number = Number(value);
      match = Number.isFinite(number) ? { const: number } : false;
    } else if (typeof value === "string") {
      const number = Number(value);
      if (Number.isFinite(number)) {
        match = {
          enum: [value, number, ...[true, false].filter(equal)],
        };
      }
    } else {
      return undefined;
    }
  }
  const truth = atom(key, match, equal, context);
  return operator === "!=" || operator === "!=="
    ? { yes: truth.no, no: truth.yes }
    : truth;
};

const relaxed = (attribute: JsonSchema, response: boolean): JsonSchema => {
  if (!response) {
    return {};
  }
  const type = attribute["type"];
  if (
    [
      "string",
      "text",
      "richtext",
      "uid",
      "email",
      "password",
      "enumeration",
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
  // Hidden structured fields skip recursive validation too. Keeping a published
  // component $ref here would silently reintroduce its required/minimum rules.
  return {};
};

interface Variant {
  mode: Context["mode"];
  published: boolean;
}

const variant = (
  suffix: string,
  defaultPublished: boolean,
): Variant | undefined => {
  if (/^(?:Published|Draft)?(?:Document|Block)$/u.test(suffix)) {
    return { mode: "response", published: !suffix.startsWith("Draft") };
  }
  if (/^(?:Published|Draft)?(?:Create|Update)Input$/u.test(suffix)) {
    return {
      mode: suffix.includes("Update") ? "update" : "create",
      published:
        suffix.startsWith("Published") ||
        (!suffix.startsWith("Draft") && defaultPublished),
    };
  }
  if (
    /^(?:Published|Draft)?(?:Create|Update)?(?:Entry|Block)Input$/u.test(suffix)
  ) {
    return {
      mode: suffix.includes("Update") ? "update" : "create",
      published: !suffix.startsWith("Draft"),
    };
  }
  return undefined;
};

const applyModel = (
  schema: JsonSchema,
  attributes: JsonSchema,
  state: Variant,
  uid: string,
  warnings: Set<string>,
): void => {
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const entries = schema[keyword];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const child = toRecord(entry);
        const required = child["required"];
        const mode =
          state.mode !== "response" &&
          Array.isArray(required) &&
          required.includes("id")
            ? "update"
            : state.mode;
        applyModel(child, attributes, { ...state, mode }, uid, warnings);
      }
    }
  }
  const properties = toRecord(schema["properties"]);
  const conditions: JsonSchema = {};
  const branches: JsonSchema[] = [];
  for (const [key, raw] of Object.entries(attributes)) {
    const attribute = toRecord(raw);
    const visible = toRecord(attribute["conditions"])["visible"];
    if (!visible || !(key in properties)) {
      continue;
    }
    const original = toRecord(properties[key]);
    const required = schema["required"];
    const wasRequired = Array.isArray(required) && required.includes(key);
    properties[key] = relaxed(attribute, state.mode === "response");
    if (Array.isArray(schema["required"])) {
      schema["required"] = schema["required"].filter(
        (entry: unknown) => entry !== key,
      );
    }
    conditions[key] = visible;
    const truth = compile(visible, { attributes, mode: state.mode });
    if (truth === undefined) {
      warnings.add(
        `${uid}.${key}: unsupported conditions.visible; validation is conservatively relaxed and the rule is retained in x-strapi-conditions`,
      );
      continue;
    }
    const then: JsonSchema = { properties: { [key]: original } };
    if (wasRequired) {
      then["required"] = [key];
    }
    branches.push({ if: truth.yes, then });
  }
  if (Object.keys(conditions).length > 0) {
    schema["x-strapi-conditions"] = conditions;
    schema["allOf"] = [
      ...(Array.isArray(schema["allOf"]) ? schema["allOf"] : []),
      ...branches,
    ];
  }
};

const applyConditions = async (
  projectDirectory: string,
  contentTypes: ContentType[],
  schemas: Record<string, JsonSchema>,
): Promise<string[]> => {
  const models: { uid: string; file: string; published: boolean }[] =
    contentTypes.map((contentType) => ({
      uid: contentType.uid,
      published: !contentType.draftAndPublish,
      file: path.join(
        projectDirectory,
        "src",
        "api",
        contentType.apiName,
        "content-types",
        contentType.uid.split(".").at(-1)!,
        "schema.json",
      ),
    }));
  const root = path.join(projectDirectory, "src", "components");
  for (const category of await listDirectories(root)) {
    for (const file of await readdir(path.join(root, category))) {
      if (file.endsWith(".json")) {
        models.push({
          uid: `${category}.${file.slice(0, -5)}`,
          file: path.join(root, category, file),
          published: true,
        });
      }
    }
  }
  const warnings = new Set<string>();
  for (const model of models) {
    const attributes = toRecord(
      parseJsonObject(await readFile(model.file, "utf8"))["attributes"],
    );
    const prefix = pascalCase(model.uid);
    for (const [name, schema] of Object.entries(schemas)) {
      let state = name.startsWith(prefix)
        ? variant(name.slice(prefix.length), model.published)
        : undefined;
      // typia preserves multi-argument helpers rather than renaming them. Its
      // OpenAPI names remove generic delimiters and escape UID punctuation.
      const decoded = name
        .replace(/-x[0-9A-F]{16}$/u, "")
        .replaceAll(/_x(?<code>[0-9A-F]{2})_/gu, (_match, code: string) =>
          String.fromCodePoint(Number.parseInt(code, 16)),
        );
      const helper = `EntryInput${model.uid}`;
      if (decoded.startsWith(helper)) {
        const flags = /^(true|false)(true|false)$/u.exec(
          decoded.slice(helper.length),
        );
        if (flags !== null) {
          state = {
            published: flags[1] === "true",
            mode: flags[2] === "true" ? "update" : "create",
          };
        }
      }
      if (state !== undefined) {
        applyModel(schema, attributes, state, model.uid, warnings);
      }
    }
  }
  return [...warnings];
};

export { applyConditions };

/* oxlint-enable unicorn/no-null */
