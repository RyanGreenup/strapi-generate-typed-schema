import type { WriteRegex } from "./attribute-regex.js";
import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";
import type { SchemaRoot } from "./schema-identity.js";

import { applyWriteRegex, writeRegex } from "./attribute-regex.js";
import { isUnknownArray, toRecord } from "./json.js";
import { schemaRef, schemaRefName } from "./schema-names.js";

type Model = Pick<ContentType, "uid" | "attributes">;

type Role = NonNullable<SchemaRoot["mode"]> | "componentUpdateDispatch";

interface Context {
  uid: string;
  role: Role;
  attributes: JsonSchema | undefined;
  rules: Map<string, WriteRegex> | undefined;
}
interface Binding {
  schema: JsonSchema;
  context: Context;
  requestInput?: string;
}

// getComponentCreateOrUpdate switches only non-draft updates without an id
// to creation. The published dispatch probes are unions of these two objects.
const branchRole = (role: Role, schema: JsonSchema): Role => {
  if (
    role !== "componentUpdateDispatch" ||
    schema["properties"] === undefined
  ) {
    return role;
  }
  const { required } = schema;
  return isUnknownArray(required) && required.includes("id")
    ? "update"
    : "create";
};

const configuredBound = (value: unknown): value is string | number =>
  typeof value === "number" || typeof value === "string";

// entity-validator/addDefault ignores configured values on optional repeatable
// components and zones. Do not evaluate a runtime default during generation.
const createDefault = (attribute: JsonSchema): unknown => {
  const { type, required, repeatable } = attribute;
  if (
    required !== true &&
    (type === "dynamiczone" || (type === "component" && repeatable === true))
  ) {
    return [];
  }
  const value = attribute["default"];
  return Object.hasOwn(attribute, "default") && typeof value !== "function"
    ? value
    : undefined;
};

const numericHints = (result: JsonSchema, attribute: JsonSchema): void => {
  const { type, min, max } = attribute;
  if (type === "integer" || type === "float" || type === "decimal") {
    result["x-strapi-coerces-numeric-string"] = true;
    if (configuredBound(min) || configuredBound(max)) {
      result["x-strapi-configured-bounds"] = {
        ...(configuredBound(min) && { minimum: min }),
        ...(configuredBound(max) && { maximum: max }),
      };
    }
  }
};

const annotations = (
  attribute: JsonSchema,
  role: Role,
  conditional: boolean,
): JsonSchema => {
  const result: JsonSchema = {};
  // Invisible fields skip addDefault; the visible then branch can still use it.
  const value =
    role === "create" && !conditional ? createDefault(attribute) : undefined;
  if (value !== undefined) {
    result["default"] = value;
  }
  if (attribute["unique"] === true) {
    result["x-strapi-unique"] = true;
  }
  const { type, allowedTypes } = attribute;
  if (type === "media" && isUnknownArray(allowedTypes)) {
    result["x-strapi-allowed-types"] = allowedTypes;
  }
  if (role !== "response") {
    numericHints(result, attribute);
  }
  return result;
};

// These branches describe the same model instance. Do not enter property values
// (relations and nested components have their own owners), predicates or examples.
const visitOwner = (
  node: JsonSchema,
  role: Role,
  visit: (schema: JsonSchema, role: Role) => void,
): void => {
  const concrete = branchRole(role, node);
  visit(node, concrete);
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    const branches = node[key];
    if (isUnknownArray(branches)) {
      for (const child of branches) {
        visitOwner(toRecord(child), concrete, visit);
      }
    }
  }
  if (node["then"] !== undefined) {
    visitOwner(toRecord(node["then"]), concrete, visit);
  }
};

const writeRules = (
  attributes: JsonSchema,
): Map<string, WriteRegex> | undefined => {
  const rules = new Map<string, WriteRegex>();
  for (const [field, raw] of Object.entries(attributes)) {
    const rule = writeRegex(toRecord(raw));
    if (rule !== undefined) {
      rules.set(field, rule);
    }
  }
  return rules.size > 0 ? rules : undefined;
};

const concreteContext = (
  root: SchemaRoot,
  sources: Map<
    string,
    { attributes: JsonSchema; rules: Map<string, WriteRegex> | undefined }
  >,
): Context | undefined => {
  const { uid, mode } = root;
  if (uid === undefined || mode === undefined) {
    return undefined;
  }
  const source = sources.get(uid);
  return {
    uid,
    role:
      root.componentUpdateDispatch === true ? "componentUpdateDispatch" : mode,
    attributes: source?.attributes,
    rules: root.publishedInput === true ? source?.rules : undefined,
  };
};

// Bind a request wrapper to the very same owner context as its probed data type.
const bindRoots = (
  models: Model[],
  roots: SchemaRoot[],
  schemas: Record<string, JsonSchema>,
): Map<string, Binding> => {
  const sources = new Map(
    models.map(
      ({ uid, attributes }) =>
        [uid, { attributes, rules: writeRules(attributes) }] as const,
    ),
  );
  const bindings = new Map<string, Binding>();
  for (const root of roots) {
    const schema = schemas[root.name];
    const context = concreteContext(root, sources);
    if (context !== undefined && schema !== undefined) {
      bindings.set(root.name, { context, schema });
    }
  }
  for (const { name, requestInput } of roots) {
    const input =
      requestInput === undefined ? undefined : bindings.get(requestInput);
    const schema = schemas[name];
    if (
      input !== undefined &&
      schema !== undefined &&
      requestInput !== undefined
    ) {
      bindings.set(name, { schema, context: input.context, requestInput });
    }
  }
  return bindings;
};

const compatible = (expected: Context, role: Role, target: Context): boolean =>
  expected.uid === target.uid &&
  role === target.role &&
  expected.rules === target.rules;

const refName = (node: JsonSchema): string | undefined =>
  typeof node["$ref"] === "string" ? schemaRefName(node["$ref"]) : undefined;

// Snapshot incompatible targets before editing any of them. Keep both branches
// of a published update dispatch when the concrete branch already has its owner.
const isolateAliases = (
  bindings: Map<string, Binding>,
  schemas: Record<string, JsonSchema>,
): void => {
  const detached: [JsonSchema, JsonSchema][] = [];
  for (const [name, root] of bindings) {
    const seen = new Set([name]);
    const isolate = (node: JsonSchema, role: Role): void => {
      const ref = refName(node);
      if (ref === undefined || seen.has(ref)) {
        return;
      }
      const target = schemas[ref];
      const owner = bindings.get(ref);
      if (
        target === undefined ||
        (owner !== undefined &&
          (owner.requestInput === undefined) ===
            (root.requestInput === undefined) &&
          compatible(root.context, branchRole(role, target), owner.context))
      ) {
        return;
      }
      seen.add(ref);
      const copy = structuredClone(target);
      visitOwner(copy, role, isolate);
      seen.delete(ref);
      detached.push([node, copy]);
    };
    visitOwner(root.schema, root.context.role, isolate);
  }
  for (const [node, copy] of detached) {
    Reflect.deleteProperty(node, "$ref");
    node["allOf"] = [
      ...(isUnknownArray(node["allOf"]) ? node["allOf"] : []),
      copy,
    ];
  }
};

// If Typia shared the wrapper or its data type, point its data to the isolated role.
const bindRequestData = (
  root: Binding,
  input: string,
  bindings: Map<string, Binding>,
): void => {
  const { context } = root;
  visitOwner(root.schema, context.role, (node) => {
    const properties = toRecord(node["properties"]);
    if (Object.hasOwn(properties, "data")) {
      const data = toRecord(properties["data"]);
      const target = refName(data);
      const owner = target === undefined ? undefined : bindings.get(target);
      if (
        owner === undefined ||
        !compatible(context, context.role, owner.context)
      ) {
        properties["data"] =
          target === undefined
            ? { $ref: schemaRef(input) }
            : { ...data, $ref: schemaRef(input) };
      }
    }
  });
};

const propertyVisitor = (
  context: Context,
  warnings: Set<string>,
): ((node: JsonSchema, role: Role) => void) => {
  const { attributes, uid, rules } = context;
  return (node, role) => {
    if (attributes === undefined) {
      return;
    }
    const conditional = toRecord(node["x-strapi-conditions"]);
    const properties = toRecord(node["properties"]);
    const annotateField = (field: string, child: unknown): void => {
      if (!Object.hasOwn(attributes, field)) {
        return;
      }
      const meta = annotations(
        toRecord(attributes[field]),
        role,
        Object.hasOwn(conditional, field),
      );
      const rule = rules?.get(field);
      if (rule === undefined && Object.keys(meta).length === 0) {
        return;
      }
      const property = child === false ? { not: {} } : toRecord(child);
      properties[field] = {
        ...(rule === undefined ? property : applyWriteRegex(property, rule)),
        ...meta,
      };
      if (rule?.portable === false) {
        warnings.add(
          `${uid}.${field}: source regex is outside the supported Unicode-equivalent subset; retained in x-strapi-regex without enforcing it`,
        );
      }
    };
    for (const [field, child] of Object.entries(properties)) {
      annotateField(field, child);
    }
  };
};

const applyAttributeMetadata = (
  models: Model[],
  roots: SchemaRoot[],
  schemas: Record<string, JsonSchema>,
): string[] => {
  const warnings = new Set<string>();
  const bindings = bindRoots(models, roots, schemas);
  isolateAliases(bindings, schemas);
  for (const root of bindings.values()) {
    if (root.requestInput === undefined) {
      visitOwner(
        root.schema,
        root.context.role,
        propertyVisitor(root.context, warnings),
      );
    } else {
      bindRequestData(root, root.requestInput, bindings);
    }
  }
  return [...warnings];
};

export { applyAttributeMetadata };
