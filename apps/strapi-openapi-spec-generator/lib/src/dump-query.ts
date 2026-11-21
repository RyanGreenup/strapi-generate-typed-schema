import { isDeepStrictEqual } from "node:util";

import type { ContentType } from "./content-types.js";
import type { JsonSchema, OpenApiDocument } from "./document.js";
import type { ModelField } from "./model-metadata.js";

import { isUnknownArray, toRecord } from "./json.js";
import { walkSchema } from "./schema-traversal.js";

type Marker = Pick<
  ContentType,
  "uid" | "kind" | "draftAndPublish" | "localized"
>;

interface ModelMetadata {
  uid: string;
  fields: Readonly<Record<string, ModelField>>;
}

interface DumpTarget extends Omit<Marker, "localized"> {
  path: string;
  schema: JsonSchema;
  query: URLSearchParams;
  models: ReadonlyMap<string, ModelMetadata>;
}

const object = (value: unknown, location: string): JsonSchema => {
  const record = toRecord(value);
  if (record !== value) {
    throw new Error(`Expected an object at ${location}`);
  }
  return record;
};

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

// qs interprets brackets structurally and ignores prototype property names.
const queryKey = (value: unknown): value is string =>
  nonempty(value) &&
  !value.includes("[") &&
  !value.includes("]") &&
  !Object.hasOwn(Object.prototype, value);

const readMarker = (value: unknown, path: string): Marker => {
  const { uid, kind, draftAndPublish, localized } = toRecord(value);
  if (
    !nonempty(uid) ||
    (kind !== "singleType" && kind !== "collectionType") ||
    typeof draftAndPublish !== "boolean" ||
    typeof localized !== "boolean"
  ) {
    throw new Error(`Invalid x-strapi-dump marker on GET ${path}`);
  }
  if (localized) {
    throw new Error(
      `Cannot dump localized model ${uid}: the specification does not enumerate locales`,
    );
  }
  return { uid, kind, draftAndPublish, localized };
};

const isField = (value: unknown): value is ModelField => {
  const field = toRecord(value);
  switch (field["kind"]) {
    case "unknown":
    case "scalar":
      return true;
    case "media":
      return typeof field["multiple"] === "boolean";
    case "component":
      return (
        queryKey(field["component"]) && typeof field["repeatable"] === "boolean"
      );
    case "dynamiczone": {
      const variants = field["components"];
      return (
        isUnknownArray(variants) &&
        variants.length > 0 &&
        variants.every(queryKey) &&
        new Set(variants).size === variants.length
      );
    }
    case "relation":
      return (
        nonempty(field["target"]) &&
        nonempty(field["relation"]) &&
        (field["mappedBy"] === undefined || nonempty(field["mappedBy"])) &&
        (field["inversedBy"] === undefined || nonempty(field["inversedBy"]))
      );
    default:
      return false;
  }
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
  let response = object(toRecord(operation["responses"])["200"], location);
  const seen = new Set<JsonSchema>();
  while (Object.hasOwn(response, "$ref")) {
    if (seen.has(response)) throw new Error(`Cyclic reference in ${location}`);
    seen.add(response);
    response = object(resolvePointer(response["$ref"], document), location);
  }
  return object(
    toRecord(toRecord(response["content"])["application/json"])["schema"],
    location,
  );
};

// A nested relation can have the requested UID too. Follow only refs, schema
// variants, the envelope's data property and data array items, in that order.
const dataSchemas = (
  schema: JsonSchema,
  document: OpenApiDocument,
  uid: string,
): JsonSchema[] => {
  const models: JsonSchema[] = [];
  const parents = new Set<JsonSchema>();
  const missing = `Missing x-strapi-model metadata for ${uid} response data`;

  const visit = (raw: unknown, inData: boolean): boolean => {
    const node = object(raw, `${uid} response schema`);
    if (parents.has(node))
      throw new Error(`Cyclic reference in ${uid} response schema`);
    parents.add(node);
    const properties = toRecord(node["properties"]);
    let found = false;
    if (inData) {
      if (Object.hasOwn(node, "x-strapi-model")) {
        models.push(node);
        found = true;
      } else if (Object.hasOwn(node, "properties")) {
        throw new Error(missing);
      }
      if (Object.hasOwn(node, "items")) {
        if (!visit(node["items"], true)) throw new Error(missing);
        found = true;
      }
    } else if (Object.hasOwn(properties, "data")) {
      if (!visit(properties["data"], true)) throw new Error(missing);
      found = true;
    }
    if (Object.hasOwn(node, "$ref")) {
      found = visit(resolvePointer(node["$ref"], document), inData) || found;
    }
    // allOf clauses can be independent constraints (for example if/then),
    // whereas every alternative of a dispatch union must identify a model.
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = node[keyword];
      if (branches === undefined) continue;
      if (!isUnknownArray(branches))
        throw new Error(`Invalid ${keyword} in ${uid} response schema`);
      const requireEach = !found && keyword !== "allOf";
      for (const branch of branches) {
        const matched = visit(branch, inData);
        if (requireEach && !matched) throw new Error(missing);
        found ||= matched;
      }
    }
    parents.delete(node);
    return found || (inData && node["type"] === "null");
  };
  visit(schema, false);
  return models;
};

// Draft, published and dynamic-zone shapes can describe different subsets of
// one model (e.g. __component). Merge them without dropping a field from either.
const readModel = (
  uid: string,
  schemas: readonly JsonSchema[],
  marker?: Marker,
): ModelMetadata => {
  if (schemas.length === 0) {
    throw new Error(`Missing x-strapi-model metadata for ${uid}`);
  }
  const fields = new Map<string, ModelField>();
  for (const schema of schemas) {
    const meta = toRecord(schema["x-strapi-model"]);
    if (
      meta["uid"] !== uid ||
      meta["kind"] !== marker?.kind ||
      meta["draftAndPublish"] !== marker?.draftAndPublish ||
      meta["localized"] !== marker?.localized
    ) {
      throw new Error(
        `Inconsistent x-strapi-model identity or flags: expected ${uid}`,
      );
    }
    const properties = object(
      schema["properties"],
      `${uid} response properties`,
    );
    const descriptors = object(meta["fields"], `${uid} x-strapi-model.fields`);
    for (const key of Object.keys(properties)) {
      if (!Object.hasOwn(descriptors, key)) {
        throw new Error(`Missing model field metadata for ${uid}.${key}`);
      }
    }
    for (const [key, field] of Object.entries(descriptors)) {
      if (
        !queryKey(key) ||
        !Object.hasOwn(properties, key) ||
        !isField(field)
      ) {
        throw new Error(`Invalid model field metadata for ${uid}.${key}`);
      }
      if (field.kind === "unknown") {
        throw new Error(
          `Unknown model field ${uid}.${key}: cannot plan complete population`,
        );
      }
      const previous = fields.get(key);
      if (previous !== undefined && !isDeepStrictEqual(previous, field)) {
        throw new Error(`Conflicting model field metadata for ${uid}.${key}`);
      }
      fields.set(key, field);
    }
  }
  return { uid, fields: Object.fromEntries(fields) };
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
      if (!Object.hasOwn(node, "x-strapi-model")) return;
      const uid = toRecord(node["x-strapi-model"])["uid"];
      if (typeof uid !== "string") return;
      const existing = index.get(uid);
      if (existing) existing.push(node);
      else index.set(uid, [node]);
    },
  });
};

const planPopulation = (
  root: ModelMetadata,
  index: ReadonlyMap<string, JsonSchema[]>,
): Pick<DumpTarget, "query" | "models"> => {
  const models = new Map([[root.uid, root]]);
  const query = new URLSearchParams();
  const parents = new Set<string>();
  const populate = (uid: string, prefix: string): ModelMetadata => {
    if (parents.has(uid)) {
      throw new Error(
        `Component cycle in dump populate: ${[...parents, uid].join(" -> ")}`,
      );
    }
    let model = models.get(uid);
    if (model === undefined) {
      model = readModel(uid, index.get(uid) ?? []);
      models.set(uid, model);
    }
    parents.add(uid);
    for (const key of Object.keys(model.fields).sort()) {
      const field = model.fields[key];
      const path = `${prefix}[${key}]`;
      switch (field?.kind) {
        case "media":
          query.set(path, "true");
          break;
        case "relation":
          if (field.mappedBy === undefined)
            query.set(`${path}[fields][0]`, "documentId");
          break;
        case "component": {
          const size = query.size;
          populate(field.component, `${path}[populate]`);
          if (query.size === size) query.set(path, "true");
          break;
        }
        case "dynamiczone":
          for (const component of field.components.toSorted()) {
            const fragment = `${path}[on][${component}]`;
            const size = query.size;
            const branch = populate(component, `${fragment}[populate]`);
            if (query.size === size) {
              const hasRelation = Object.values(branch.fields).some(
                (entry) => entry.kind === "relation",
              );
              // qs drops populate: []. Strapi's fields=* retains the fragment
              // and all its scalar fields without requesting inverse relations.
              query.set(
                `${fragment}[${hasRelation ? "fields" : "populate"}]`,
                "*",
              );
            }
          }
          break;
      }
    }
    parents.delete(uid);
    return model;
  };
  populate(root.uid, "populate");
  return { query, models };
};

const planDump = (specification: OpenApiDocument): DumpTarget[] => {
  const marked = new Map<
    string,
    { marker: Marker; path: string; schema: JsonSchema }
  >();
  const index = new Map<string, JsonSchema[]>();
  for (const [path, methods] of Object.entries(specification.paths)) {
    const operation = methods["get"];
    if (!operation || !Object.hasOwn(operation, "x-strapi-dump")) continue;
    const marker = readMarker(operation["x-strapi-dump"], path);
    if (marked.has(marker.uid))
      throw new Error(`Duplicate x-strapi-dump marker for ${marker.uid}`);
    const schema = responseSchema(operation, specification, path);
    marked.set(marker.uid, { marker, path, schema });
    indexModels(schema, index);
  }
  if (marked.size === 0) return [];
  for (const schema of Object.values(specification.components.schemas))
    indexModels(schema, index);
  return [...marked.values()]
    .sort((a, b) =>
      a.marker.uid < b.marker.uid ? -1 : Number(a.marker.uid > b.marker.uid),
    )
    .map(({ marker, path, schema }) => {
      const { uid, kind, draftAndPublish } = marker;
      const root = readModel(
        uid,
        dataSchemas(schema, specification, uid),
        marker,
      );
      return {
        uid,
        kind,
        draftAndPublish,
        path,
        schema,
        ...planPopulation(root, index),
      };
    });
};

export { planDump };
export type { DumpTarget, ModelMetadata };
