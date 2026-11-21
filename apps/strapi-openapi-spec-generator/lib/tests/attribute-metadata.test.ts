import { describe, expect, it, vi } from "vitest";

import type { JsonSchema } from "../src/document.js";
import type { SchemaRoot } from "../src/schema-identity.js";

import { applyAttributeMetadata } from "../src/attribute-metadata.js";
import { isUnknownArray, toRecord } from "../src/json.js";
import {
  renameSchemas,
  schemaRef,
  schemaRefName,
} from "../src/schema-names.js";
import { modelProbes } from "../src/schema-probes.js";

vi.setConfig({ testTimeout: 5000 });

const ref = (name: string): JsonSchema => ({ $ref: schemaRef(name) });
const componentUid = "shared.seo";
const probes = modelProbes({
  uid: componentUid,
  drafts: true,
  component: true,
});
const componentRoot = (suffix: string, schema: JsonSchema): SchemaRoot => {
  const probe = probes.find(
    ({ identity }) => identity.name === `SharedSeo${suffix}`,
  );
  if (probe === undefined) {
    throw new Error(`Missing probe ${suffix}`);
  }
  return { ...probe.identity, schema };
};

// Follow only aliases and their allOf siblings (not property or relation refs).
const property = (
  schemas: Record<string, JsonSchema>,
  schema: JsonSchema,
  field: string,
): unknown => {
  if (Object.hasOwn(toRecord(schema["properties"]), field)) {
    return toRecord(schema["properties"])[field];
  }
  const target =
    typeof schema["$ref"] === "string"
      ? schemaRefName(schema["$ref"])
      : undefined;
  if (target !== undefined && schemas[target] !== undefined) {
    return property(schemas, schemas[target], field);
  }
  if (isUnknownArray(schema["allOf"])) {
    for (const branch of schema["allOf"]) {
      const found = property(schemas, toRecord(branch), field);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
};

describe("metadata on shared emitted shapes", () => {
  it.each([
    ["Create", "Update"],
    ["Update", "Create"],
  ])(
    "isolates models, roles and their request bodies when %s owns the shared shape",
    (canonical, alias) => {
      const uid = "api::article.article";
      const roots: SchemaRoot[] = [
        {
          uid,
          name: "Create",
          mode: "create",
          publishedInput: true,
          schema: ref("shared"),
        },
        {
          uid,
          name: "Update",
          mode: "update",
          publishedInput: true,
          schema: ref("shared"),
        },
        { uid, name: "Read", mode: "response", schema: ref("shared") },
        {
          uid: "shared.other",
          name: "OtherCreate",
          mode: "create",
          schema: ref("shared"),
        },
        {
          uid,
          name: "CreateRequest",
          requestInput: "Create",
          schema: ref("body"),
        },
        {
          uid,
          name: "UpdateRequest",
          requestInput: "Update",
          schema: ref("body"),
        },
      ];
      const first = (name: string): boolean =>
        [canonical, `${canonical}Request`].includes(name);
      roots.sort((a, b) => Number(first(b.name)) - Number(first(a.name)));
      const schemas = renameSchemas(
        {
          shared: { properties: { count: { type: "number" } } },
          body: { properties: { data: ref("shared") }, required: ["data"] },
        },
        roots,
      );
      expect([schemas[alias], schemas[`${alias}Request`]]).toStrictEqual([
        ref(canonical),
        ref(`${canonical}Request`),
      ]);
      const articleCount = {
        type: "integer",
        default: 0,
        unique: true,
        min: "02",
        max: 9,
      };
      applyAttributeMetadata(
        [
          { uid, attributes: { count: articleCount } },
          {
            uid: "shared.other",
            attributes: { count: { type: "integer", default: 4 } },
          },
        ],
        roots,
        schemas,
      );

      const read = { type: "number", "x-strapi-unique": true };
      const update = {
        ...read,
        "x-strapi-coerces-numeric-string": true,
        "x-strapi-configured-bounds": { minimum: "02", maximum: 9 },
      };
      const counts = Object.fromEntries(
        ["Create", "Update", "Read", "OtherCreate"].map((name) => [
          name,
          property(schemas, toRecord(schemas[name]), "count"),
        ]),
      );
      expect(counts).toStrictEqual({
        Create: { ...update, default: 0 },
        Update: update,
        Read: read,
        OtherCreate: {
          type: "number",
          default: 4,
          "x-strapi-coerces-numeric-string": true,
        },
      });
      expect(
        property(schemas, toRecord(schemas["CreateRequest"]), "data"),
      ).toStrictEqual(ref("Create"));
      expect(
        property(schemas, toRecord(schemas["UpdateRequest"]), "data"),
      ).toStrictEqual(ref("Update"));
    },
  );

  it.each([
    ["Entry", "PublishedEntryInput", "Entry"],
    ["Block", "PublishedUpdateBlockInput", "Zone"],
  ])(
    "keeps new and existing %s alternatives distinct in published update dispatch",
    (kind, dispatch, helper) => {
      const roots = [
        componentRoot(`PublishedExisting${kind}Input`, ref("existing")),
        componentRoot(`PublishedNew${kind}Input`, ref("new")),
        componentRoot(dispatch, ref("dispatch")),
        componentRoot(`PublishedUpdate${helper}Helper`, ref("dispatch")),
      ];
      const label = { type: "string" };
      const schemas = renameSchemas(
        {
          existing: {
            properties: { id: { type: "integer" }, label },
            required: ["id"],
          },
          new: { properties: { label } },
          dispatch: { oneOf: [ref("existing"), ref("new")] },
        },
        roots,
      );
      applyAttributeMetadata(
        [
          {
            uid: componentUid,
            attributes: { label: { type: "string", default: "new" } },
          },
        ],
        roots,
        schemas,
      );
      const dispatchSchema = toRecord(schemas[`SharedSeo${dispatch}`]);
      expect(dispatchSchema["oneOf"]).toStrictEqual([
        ref(`SharedSeoPublishedExisting${kind}Input`),
        ref(`SharedSeoPublishedNew${kind}Input`),
      ]);
      expect(
        property(
          schemas,
          toRecord(schemas[`SharedSeoPublishedExisting${kind}Input`]),
          "label",
        ),
      ).toStrictEqual(label);
      expect(
        property(
          schemas,
          toRecord(schemas[`SharedSeoPublishedNew${kind}Input`]),
          "label",
        ),
      ).toStrictEqual({ ...label, default: "new" });
      expect(schemas[`SharedSeoPublishedUpdate${helper}Helper`]).toStrictEqual(
        ref(`SharedSeo${dispatch}`),
      );
    },
  );

  it("applies creation defaults only to visible fields, optional arrays, and known values", () => {
    const roots = ["DraftCreateEntryInput", "DraftEntryInput"].map((suffix) =>
      componentRoot(suffix, ref("shared")),
    );
    // oxlint-disable-next-line unicorn/no-null -- explicit JSON null is an attribute default.
    const jsonNull = null;
    const attributes = {
      blocks: { type: "dynamiczone", default: ["ignored"] },
      entries: { type: "component", repeatable: true },
      requiredEntries: { type: "component", repeatable: true, required: true },
      computed: {
        type: "string",
        default: () => {
          throw new Error("must not run");
        },
      },
      maybe: { type: "string", default: jsonNull },
      visible: { type: "boolean", default: false },
    };
    const properties = Object.fromEntries(
      Object.keys(attributes).map((key) => [key, {}]),
    );
    const schemas = renameSchemas(
      {
        shared: {
          properties,
          "x-strapi-conditions": { visible: true },
          allOf: [
            {
              if: { required: ["flag"] },
              // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema keyword.
              then: { properties: { visible: { type: "boolean" } } },
            },
          ],
        },
      },
      roots,
    );
    applyAttributeMetadata([{ uid: componentUid, attributes }], roots, schemas);
    const create = toRecord(schemas["SharedSeoDraftCreateEntryInput"]);
    expect(create["properties"]).toStrictEqual({
      blocks: { default: [] },
      entries: { default: [] },
      requiredEntries: {},
      computed: {},
      maybe: { default: jsonNull },
      visible: {},
    });
    expect(create["allOf"]).toMatchObject([
      {
        // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema keyword.
        then: { properties: { visible: { default: false } } },
      },
    ]);
    for (const field of Object.keys(attributes)) {
      expect(
        property(schemas, toRecord(schemas["SharedSeoDraftEntryInput"]), field),
      ).toStrictEqual({});
    }
  });
});
