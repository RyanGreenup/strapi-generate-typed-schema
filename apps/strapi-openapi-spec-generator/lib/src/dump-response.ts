import type { JsonSchema, OpenApiDocument } from "./document.js";

import { isUnknownArray, toRecord } from "./json.js";
import { walkSchema } from "./schema-traversal.js";

const schemaObject = (value: unknown, location: string): JsonSchema => {
  const record = toRecord(value);
  if (record !== value) {
    throw new Error(`Expected an object at ${location}`);
  }
  return record;
};

// Decode the URI fragment before interpreting JSON Pointer tokens. Only own
// properties of this very specification can be targets; never fetch a ref.
const resolvePointer = (ref: unknown, document: OpenApiDocument): unknown => {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(
      "Dump response schemas must use local JSON Pointer references",
    );
  }
  let current: unknown = document;
  for (const token of decodeURIComponent(ref.slice(2)).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      /~(?![01])/u.test(token) ||
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, key) ||
      (isUnknownArray(current) && !/^(?:0|[1-9]\d*)$/u.test(key))
    ) {
      throw new Error(`Invalid dump schema reference: ${ref}`);
    }
    current = isUnknownArray(current)
      ? current[Number(key)]
      : toRecord(current)[key];
  }
  return current;
};

const responseSchema = (
  operation: JsonSchema,
  document: OpenApiDocument,
  path: string,
): JsonSchema => {
  const location = `GET ${path} 200 application/json response`;
  let response = schemaObject(
    toRecord(operation["responses"])["200"],
    location,
  );
  const seen = new Set<JsonSchema>();
  while (Object.hasOwn(response, "$ref")) {
    if (seen.has(response)) {
      throw new Error(`Cyclic reference in ${location}`);
    }
    seen.add(response);
    response = schemaObject(
      resolvePointer(response["$ref"], document),
      location,
    );
  }
  return schemaObject(
    toRecord(toRecord(response["content"])["application/json"])["schema"],
    location,
  );
};

const collectModel = (
  node: JsonSchema,
  models: JsonSchema[],
  missing: string,
): boolean => {
  if (Object.hasOwn(node, "x-strapi-model")) {
    models.push(node);
    return true;
  }
  if (Object.hasOwn(node, "properties")) {
    throw new Error(missing);
  }
  return false;
};

// Visit every branch; an unmatched dispatch union must match in each one.
const visitBranches = (
  branches: unknown[],
  visit: (branch: unknown) => boolean,
  { requireEach, missing }: { requireEach: boolean; missing: string },
): boolean => {
  let found = false;
  for (const branch of branches) {
    const matched = visit(branch);
    if (requireEach && !matched) {
      throw new Error(missing);
    }
    found ||= matched;
  }
  return found;
};

// A nested relation can have the requested UID too. Follow only refs, schema
// variants, the envelope's data property and data array items.
const dataSchemas = (
  schema: JsonSchema,
  document: OpenApiDocument,
  uid: string,
): JsonSchema[] => {
  const models: JsonSchema[] = [];
  const parents = new Set<JsonSchema>();
  const missing = `Missing x-strapi-model metadata for ${uid} response data`;
  const location = `${uid} response schema`;

  function requireModel(raw: unknown): true {
    if (!visit(raw, true)) {
      throw new Error(missing);
    }
    return true;
  }

  function visitData(node: JsonSchema, inData: boolean): boolean {
    if (!inData) {
      const properties = toRecord(node["properties"]);
      return (
        Object.hasOwn(properties, "data") && requireModel(properties["data"])
      );
    }
    const marked = collectModel(node, models, missing);
    return Object.hasOwn(node, "items") ? requireModel(node["items"]) : marked;
  }

  function visitVariants(
    node: JsonSchema,
    inData: boolean,
    directMatch: boolean,
  ): boolean {
    let found = directMatch;
    // allOf can contain independent constraints, while an unmatched dispatch
    // union must identify a model in each alternative.
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = node[keyword];
      if (branches !== undefined) {
        if (!isUnknownArray(branches)) {
          throw new Error(`Invalid ${keyword} in ${location}`);
        }
        const requireEach = !found && keyword !== "allOf";
        found =
          visitBranches(branches, (branch) => visit(branch, inData), {
            requireEach,
            missing,
          }) || found;
      }
    }
    return found;
  }

  function visit(raw: unknown, inData: boolean): boolean {
    const node = schemaObject(raw, location);
    if (parents.has(node)) {
      throw new Error(`Cyclic reference in ${location}`);
    }
    parents.add(node);
    let found = visitData(node, inData);
    if (Object.hasOwn(node, "$ref")) {
      found = visit(resolvePointer(node["$ref"], document), inData) || found;
    }
    found = visitVariants(node, inData, found);
    parents.delete(node);
    return found || (inData && node["type"] === "null");
  }

  visit(schema, false);
  return models;
};

// Record schema nodes, not annotations in arbitrary examples/defaults. Parse
// them only for component UIDs actually reached by a dumpable operation.
const indexModels = (
  schema: JsonSchema,
  index: Map<string, JsonSchema[]>,
): void => {
  walkSchema(schema, {
    copy: false,
    visit(node) {
      if (!Object.hasOwn(node, "x-strapi-model")) {
        return;
      }
      const { uid } = toRecord(node["x-strapi-model"]);
      if (typeof uid !== "string") {
        return;
      }
      const existing = index.get(uid);
      if (existing) {
        existing.push(node);
      } else {
        index.set(uid, [node]);
      }
    },
  });
};

export { dataSchemas, indexModels, responseSchema, schemaObject };
