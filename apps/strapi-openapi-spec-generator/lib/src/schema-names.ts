import type { JsonSchema } from "./document.js";
import type { SchemaRoot } from "./schema-identity.js";
import type { SchemaVisitor } from "./schema-traversal.js";

import { isUnknownArray, toRecord } from "./json.js";
import { walkSchema } from "./schema-traversal.js";

const PREFIX = "#/components/schemas/";

/** Encode one component name as a URI fragment containing a JSON Pointer. */
const schemaRef = (name: string): string =>
  `${PREFIX}${encodeURIComponent(name.replaceAll("~", "~0").replaceAll("/", "~1"))}`;

/** Return the exact component target, leaving external references alone. */
const schemaRefName = (ref: string): string | undefined => {
  if (!ref.startsWith("#")) {
    return undefined;
  }
  if (!ref.startsWith(PREFIX)) {
    throw new Error(`Expected a local schema component reference: ${ref}`);
  }
  const token = decodeURIComponent(ref.slice(PREFIX.length));
  if (token.length === 0 || token.includes("/") || /~(?![01])/u.test(token)) {
    throw new Error(`Expected a local schema component reference: ${ref}`);
  }
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
};

const bareRef = (value: unknown): string | undefined => {
  const record = toRecord(value);
  return typeof record["$ref"] === "string" && Object.keys(record).length === 1
    ? schemaRefName(record["$ref"])
    : undefined;
};

const localTarget = (
  ref: unknown,
  components: Record<string, unknown>,
  mapping = false,
): string | undefined => {
  if (typeof ref !== "string") {
    throw new TypeError("Expected a string schema reference");
  }
  // OpenAPI permits bare component names as discriminator mapping values.
  // Prefer a schema name for an ambiguous bare relative URI; ./foo is a URI.
  const bare =
    mapping &&
    !ref.startsWith("#") &&
    (Object.hasOwn(components, ref) || /^[A-Za-z0-9._-]+$/u.test(ref));
  const name = bare ? ref : schemaRefName(ref);
  if (name !== undefined && !Object.hasOwn(components, name)) {
    throw new Error(`Unresolved local schema reference: ${ref}`);
  }
  return name;
};

type Replacement = (ref: unknown, mapping: boolean) => string | undefined;

const visitDiscriminator = (
  node: JsonSchema,
  replacement: Replacement,
): void => {
  const discriminator = toRecord(node["discriminator"]);
  const mapping = toRecord(discriminator["mapping"]);
  let updated = mapping;
  for (const [tag, value] of Object.entries(mapping)) {
    const ref = replacement(value, true);
    if (ref !== undefined && ref !== value) {
      if (updated === mapping) {
        updated = { ...mapping };
      }
      updated[tag] = ref;
    }
  }
  if (updated !== mapping) {
    // The visitor copied the schema node, not its discriminator or its payload examples.
    node["discriminator"] = { ...discriminator, mapping: updated };
  }
};

const referenceVisitor = (
  schemas: Record<string, unknown>,
  names?: Map<string, string>,
  visitTarget?: (name: string) => void,
): SchemaVisitor => {
  const replacement: Replacement = (ref, mapping) => {
    const target = localTarget(ref, schemas, mapping);
    if (target !== undefined) {
      visitTarget?.(target);
    }
    const name = target === undefined ? undefined : names?.get(target);
    return name === undefined ? undefined : schemaRef(name);
  };
  return {
    copy: names !== undefined,
    visit: (node) => {
      if (node["$ref"] !== undefined) {
        const ref = replacement(node["$ref"], false);
        if (ref !== undefined) {
          node["$ref"] = ref;
        }
      }
      if (node["discriminator"] !== undefined) {
        visitDiscriminator(node, replacement);
      }
    },
  };
};

/** Visit exact local component references, including discriminator targets. */
const visitSchemaRefs = (
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>,
  visit: (name: string) => void,
): void => {
  walkSchema(schema, referenceVisitor(schemas, undefined, visit));
};

/** Fail if a generated schema refers to an absent local component. */
const validateSchemaRefs = (schemas: Record<string, unknown>): void => {
  const visitor = referenceVisitor(schemas);
  for (const schema of Object.values(schemas)) {
    walkSchema(schema, visitor);
  }
};

const statePairKey = (a: string, b: string): string =>
  JSON.stringify(a < b ? [a, b] : [b, a]);

// A single nullable alternative is allowed, but a reference with siblings is
// not interchangeable with its target: those siblings can restrict the branch.
const statePair = (branches: unknown[]): string | undefined => {
  const refs: string[] = [];
  let nullable = false;
  for (const branch of branches) {
    const name = bareRef(branch);
    if (name !== undefined) {
      refs.push(name);
    } else if (
      !nullable &&
      toRecord(branch)["type"] === "null" &&
      Object.keys(toRecord(branch)).length === 1
    ) {
      nullable = true;
    } else {
      return undefined;
    }
  }
  const [first, second] = refs;
  return refs.length === 2 && first !== undefined && second !== undefined
    ? statePairKey(first, second)
    : undefined;
};

type States = Partial<Record<NonNullable<SchemaRoot["state"]>, string>>;

const statesByUid = (
  roots: SchemaRoot[],
  names: Map<string, string>,
): Map<string, States> => {
  const byUid = new Map<string, States>();
  for (const { uid, state, schema, name } of roots) {
    if (uid !== undefined && state !== undefined) {
      const states = byUid.get(uid) ?? {};
      const target = bareRef(schema);
      states[state] = target === undefined ? name : (names.get(target) ?? name);
      byUid.set(uid, states);
    }
  }
  return byUid;
};

/** Index state pairs by their actual components, not by public-name suffix. */
const publicationGroups = (
  byUid: Map<string, States>,
  schemas: Record<string, JsonSchema>,
): Map<string, string | undefined> => {
  const groups = new Map<string, string | undefined>();
  for (const { document, published, draft } of byUid.values()) {
    if (
      document !== undefined &&
      published !== undefined &&
      draft !== undefined
    ) {
      const key = statePairKey(published, draft);
      const schema = toRecord(schemas[document]);
      const branches = schema["oneOf"] ?? schema["anyOf"];
      // Only an unconstrained document is interchangeable with the union.
      // If two UIDs share a state pair we cannot infer either UID.
      const canReference =
        !groups.has(key) &&
        Object.keys(schema).length === 1 &&
        isUnknownArray(branches) &&
        branches.length === 2 &&
        statePair(branches) === key;
      groups.set(key, canReference ? document : undefined);
    }
  }
  return groups;
};

type UnionKeyword = "oneOf" | "anyOf";

// Substitute a logically equivalent schema without overwriting an existing
// sibling keyword (for example, a schema can have both oneOf and anyOf).
const replaceUnion = (
  schema: JsonSchema,
  keyword: UnionKeyword,
  [key, value]: ["$ref" | "anyOf", unknown],
): void => {
  if (key !== keyword && Object.hasOwn(schema, key)) {
    schema[keyword] = [{ [key]: value }];
    return;
  }
  Reflect.deleteProperty(schema, keyword);
  schema[key] = value;
};

const publicationVisitor = (
  groups: Map<string, string | undefined>,
  schemas: Record<string, JsonSchema>,
): SchemaVisitor => {
  const group = (schema: JsonSchema, keyword: UnionKeyword): void => {
    const branches = schema[keyword];
    if (!isUnknownArray(branches)) {
      return;
    }
    const pair = statePair(branches);
    if (pair === undefined || !groups.has(pair)) {
      return;
    }
    const document = groups.get(pair);
    if (document === undefined || schemas[document] === schema) {
      // A projection omitting publishedAt can match both publication states.
      if (keyword === "oneOf") {
        replaceUnion(schema, keyword, ["anyOf", branches]);
      }
      return;
    }
    const ref = { $ref: schemaRef(document) };
    if (branches.length === 2) {
      replaceUnion(schema, keyword, ["$ref", ref.$ref]);
    } else {
      schema[keyword] = [
        ref,
        ...branches.filter((branch) => bareRef(branch) === undefined),
      ];
    }
  };
  return {
    copy: false,
    visit: (node) => {
      group(node, "anyOf");
      group(node, "oneOf");
    },
  };
};

const canonicalNames = (
  raw: Record<string, unknown>,
  roots: SchemaRoot[],
): Map<string, string> => {
  const names = new Map<string, string>();
  const publicRoots = new Map<string, SchemaRoot>();
  for (const root of roots) {
    const { name, schema } = root;
    const target = bareRef(schema);
    const previous = publicRoots.get(name);
    if (
      previous !== undefined ||
      (Object.hasOwn(raw, name) && target !== name)
    ) {
      throw new Error(
        `Ambiguous public schema name ${name} (${previous?.uid ?? "emitted component"} and ${root.uid ?? name})`,
      );
    }
    publicRoots.set(name, root);
    if (target !== undefined && !names.has(target)) {
      localTarget(toRecord(schema)["$ref"], raw);
      names.set(target, name);
    }
  }
  return names;
};

/** Bind the public names to the actual tuple entries returned by typia. */
const renameSchemas = (
  raw: Record<string, unknown>,
  roots: SchemaRoot[],
): Record<string, JsonSchema> => {
  const names = canonicalNames(raw, roots);
  const rewriteRefs = referenceVisitor(raw, names);
  const rewrite = (input: unknown): JsonSchema => {
    const schema = walkSchema(input, rewriteRefs);
    // The downstream condition pass works with object-form schemas.
    return schema === false ? { not: {} } : toRecord(schema);
  };
  const components = new Map(
    Object.entries(raw).map(
      ([name, schema]) => [names.get(name) ?? name, rewrite(schema)] as const,
    ),
  );
  for (const { name, schema } of roots) {
    if (!components.has(name)) {
      // A second public name for a flattened type aliases the canonical name.
      components.set(name, rewrite(schema));
    }
  }
  const schemas = Object.fromEntries(components);
  const groups = publicationGroups(statesByUid(roots, names), schemas);
  const visitor = publicationVisitor(groups, schemas);
  for (const schema of components.values()) {
    walkSchema(schema, visitor);
  }
  return schemas;
};

// Typia names a generic instantiation after the template and its encoded type
// arguments, ending in a hash such as "-x0D2C2A730D26B44A".
const TYPIA_INSTANCE = /-x[0-9A-F]{16}$/u;

/** List components that kept typia's instantiation name because no probe root named them. */
const unnamedSchemas = (schemas: Record<string, JsonSchema>): string[] =>
  Object.keys(schemas).filter((name) => TYPIA_INSTANCE.test(name));

export {
  renameSchemas,
  schemaRef,
  schemaRefName,
  unnamedSchemas,
  validateSchemaRefs,
  visitSchemaRefs,
};
