import { isDeepStrictEqual } from "node:util";

import type { ContentType } from "./content-types.js";
import type { JsonSchema, OpenApiDocument } from "./document.js";
import type { ModelField } from "./model-metadata.js";

import {
  dataSchemas,
  indexModels,
  responseSchema,
  schemaObject,
} from "./dump-response.js";
import { isUnknownArray, toRecord } from "./json.js";

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
    case "scalar": {
      return true;
    }
    case "media": {
      return typeof field["multiple"] === "boolean";
    }
    case "component": {
      return (
        queryKey(field["component"]) && typeof field["repeatable"] === "boolean"
      );
    }
    case "dynamiczone": {
      const variants = field["components"];
      return (
        isUnknownArray(variants) &&
        variants.length > 0 &&
        variants.every((variant) => queryKey(variant)) &&
        new Set(variants).size === variants.length
      );
    }
    case "relation": {
      return (
        nonempty(field["target"]) &&
        nonempty(field["relation"]) &&
        (field["mappedBy"] === undefined || nonempty(field["mappedBy"])) &&
        (field["inversedBy"] === undefined || nonempty(field["inversedBy"]))
      );
    }
    default: {
      return false;
    }
  }
};

interface SchemaFields {
  uid: string;
  properties: JsonSchema;
  descriptors: JsonSchema;
}

const schemaFields = (
  uid: string,
  schema: JsonSchema,
  marker?: Marker,
): SchemaFields => {
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
  const properties = schemaObject(
    schema["properties"],
    `${uid} response properties`,
  );
  const descriptors = schemaObject(
    meta["fields"],
    `${uid} x-strapi-model.fields`,
  );
  for (const key of Object.keys(properties)) {
    if (!Object.hasOwn(descriptors, key)) {
      throw new Error(`Missing model field metadata for ${uid}.${key}`);
    }
  }
  return { uid, properties, descriptors };
};

const mergeFields = (
  fields: Map<string, ModelField>,
  { uid, properties, descriptors }: SchemaFields,
): void => {
  for (const [key, field] of Object.entries(descriptors)) {
    if (!queryKey(key) || !Object.hasOwn(properties, key) || !isField(field)) {
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
    mergeFields(fields, schemaFields(uid, schema, marker));
  }
  return { uid, fields: Object.fromEntries(fields) };
};

interface PopulationWriter {
  query: URLSearchParams;
  populate: (uid: string, prefix: string) => ModelMetadata;
}

const populateFragment = (
  component: string,
  fragment: string,
  { query, populate }: PopulationWriter,
): void => {
  const { size } = query;
  const branch = populate(component, `${fragment}[populate]`);
  if (query.size === size) {
    const hasRelation = Object.values(branch.fields).some(
      (entry) => entry.kind === "relation",
    );
    // qs drops populate: []. Strapi's fields=* retains the fragment
    // and all its scalar fields without requesting inverse relations.
    query.set(`${fragment}[${hasRelation ? "fields" : "populate"}]`, "*");
  }
};

const planPopulation = (
  root: ModelMetadata,
  index: ReadonlyMap<string, JsonSchema[]>,
): Pick<DumpTarget, "query" | "models"> => {
  const models = new Map([[root.uid, root]]);
  const query = new URLSearchParams();
  const parents = new Set<string>();
  const writer = { query, populate };

  function populateField(field: ModelField, path: string): void {
    if (field.kind === "media") {
      query.set(path, "true");
      return;
    }
    if (field.kind === "relation") {
      if (field.mappedBy === undefined) {
        query.set(`${path}[fields][0]`, "documentId");
      }
      return;
    }
    if (field.kind === "component") {
      const { size } = query;
      populate(field.component, `${path}[populate]`);
      if (query.size === size) {
        query.set(path, "true");
      }
      return;
    }
    if (field.kind === "dynamiczone") {
      for (const component of field.components.toSorted()) {
        populateFragment(component, `${path}[on][${component}]`, writer);
      }
    }
  }

  function populate(uid: string, prefix: string): ModelMetadata {
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
    for (const key of Object.keys(model.fields).toSorted()) {
      const field = model.fields[key];
      if (field !== undefined) {
        populateField(field, `${prefix}[${key}]`);
      }
    }
    parents.delete(uid);
    return model;
  }

  populate(root.uid, "populate");
  return { query, models };
};

interface MarkedResponse {
  marker: Marker;
  path: string;
  schema: JsonSchema;
}

const markedResponses = (
  specification: OpenApiDocument,
  index: Map<string, JsonSchema[]>,
): MarkedResponse[] => {
  const marked = new Map<string, MarkedResponse>();
  for (const [path, { get: operation }] of Object.entries(
    specification.paths,
  )) {
    if (operation && Object.hasOwn(operation, "x-strapi-dump")) {
      const marker = readMarker(operation["x-strapi-dump"], path);
      if (marked.has(marker.uid)) {
        throw new Error(`Duplicate x-strapi-dump marker for ${marker.uid}`);
      }
      const schema = responseSchema(operation, specification, path);
      marked.set(marker.uid, { marker, path, schema });
      indexModels(schema, index);
    }
  }
  return [...marked.values()].toSorted((a, b) =>
    a.marker.uid < b.marker.uid ? -1 : Number(a.marker.uid > b.marker.uid),
  );
};

const planDump = (specification: OpenApiDocument): DumpTarget[] => {
  const index = new Map<string, JsonSchema[]>();
  const marked = markedResponses(specification, index);
  if (marked.length === 0) {
    return [];
  }
  for (const schema of Object.values(specification.components.schemas)) {
    indexModels(schema, index);
  }
  return marked.map(({ marker, path, schema }) => {
    const { uid, kind, draftAndPublish } = marker;
    const root = readModel(
      uid,
      dataSchemas(schema, specification, uid),
      marker,
    );
    const { query, models } = planPopulation(root, index);
    return { uid, kind, draftAndPublish, path, schema, query, models };
  });
};

export { planDump };
export type { DumpTarget, ModelMetadata };
