import type { ContentType } from "./content-types.js";
import type { JsonSchema } from "./document.js";
import type { SchemaRoot } from "./schema-identity.js";

import { isUnknownArray, toRecord } from "./json.js";
import { visitResponseObjects } from "./relations.js";

type Model = Pick<ContentType, "uid" | "attributes"> &
  Partial<Pick<ContentType, "kind" | "draftAndPublish" | "localized">>;

type ModelField =
  | { kind: "scalar" }
  | { kind: "unknown" }
  | { kind: "component"; component: string; repeatable: boolean }
  | { kind: "dynamiczone"; components: string[] }
  | { kind: "media"; multiple: boolean }
  | {
      kind: "relation";
      target: string;
      relation: string;
      mappedBy?: string;
      inversedBy?: string;
    };

const SYSTEM_FIELDS: Record<string, true> = {
  id: true,
  documentId: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  locale: true,
  __component: true,
};

const describeRelation = (attribute: JsonSchema): ModelField => {
  const { target, relation, mappedBy, inversedBy } = attribute;
  return typeof target === "string" && typeof relation === "string"
    ? {
        kind: "relation",
        target,
        relation,
        ...(typeof mappedBy === "string" && { mappedBy }),
        ...(typeof inversedBy === "string" && { inversedBy }),
      }
    : { kind: "unknown" };
};

const describeAttribute = (attribute: JsonSchema): ModelField => {
  const { type, component, components } = attribute;
  switch (type) {
    case "component": {
      return typeof component === "string"
        ? {
            kind: type,
            component,
            repeatable: attribute["repeatable"] === true,
          }
        : { kind: "unknown" };
    }
    case "dynamiczone": {
      return isUnknownArray(components) &&
        components.every((uid) => typeof uid === "string")
        ? { kind: type, components }
        : { kind: "unknown" };
    }
    case "media": {
      return { kind: type, multiple: attribute["multiple"] === true };
    }
    case "relation": {
      return describeRelation(attribute);
    }
    default: {
      return { kind: typeof type === "string" ? "scalar" : "unknown" };
    }
  }
};

const describeField = (model: Model, field: string): ModelField => {
  if (!Object.hasOwn(model.attributes, field)) {
    return { kind: Object.hasOwn(SYSTEM_FIELDS, field) ? "scalar" : "unknown" };
  }
  return describeAttribute(toRecord(model.attributes[field]));
};

/** Describe only emitted fields; registration can add fields absent from model JSON. */
const applyModelMetadata = (
  models: Model[],
  roots: SchemaRoot[],
  schemas: Record<string, JsonSchema>,
): string[] => {
  const warnings: string[] = [];
  const responseSchemas = { roots, schemas };
  for (const model of models) {
    const descriptions = new Map<string, ModelField>();
    const { uid, kind, localized, draftAndPublish } = model;
    visitResponseObjects(uid, responseSchemas, (schema) => {
      const fields = Object.fromEntries(
        Object.keys(toRecord(schema["properties"])).map((field) => {
          let descriptor = descriptions.get(field);
          if (descriptor === undefined) {
            descriptor = describeField(model, field);
            descriptions.set(field, descriptor);
            if (descriptor.kind === "unknown") {
              warnings.push(
                `${uid}.${field}: cannot determine population from the source model; marked unknown in x-strapi-model`,
              );
            }
          }
          return [field, descriptor];
        }),
      );
      schema["x-strapi-model"] = {
        uid,
        ...(kind !== undefined && { kind, draftAndPublish, localized }),
        fields,
      };
    });
  }
  return warnings;
};

export { applyModelMetadata };
export type { ModelField };
