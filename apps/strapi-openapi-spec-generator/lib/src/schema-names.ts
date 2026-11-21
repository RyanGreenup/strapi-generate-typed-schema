import type { ConditionContext } from "./condition-predicates.js";
import type { JsonSchema } from "./document.js";

import { isUnknownArray, parseJsonObject, toRecord } from "./json.js";
import { pascalCase } from "./names.js";

type Mode = ConditionContext["mode"];

// Request envelopes are renamed too, but conditions apply only to model fields.
const VARIANTS: [generic: string, suffix: string, mode: Mode | undefined][] = [
  ["PublishedExistingComponentInput", "PublishedExistingEntryInput", "update"],
  ["PublishedNewComponentInput", "PublishedNewEntryInput", "create"],
  ["PublishedExistingZoneInput", "PublishedExistingBlockInput", "update"],
  ["PublishedNewZoneInput", "PublishedNewBlockInput", "create"],
  ["DraftCreateComponentInput", "DraftCreateEntryInput", "create"],
  ["PublishedCreateComponentInput", "PublishedCreateEntryInput", "create"],
  ["DraftCreateZoneInput", "DraftCreateBlockInput", "create"],
  ["PublishedCreateZoneInput", "PublishedCreateBlockInput", "create"],
  ["DraftUpdateZoneInput", "DraftUpdateBlockInput", "update"],
  ["PublishedUpdateZoneInput", "PublishedUpdateBlockInput", "update"],
  ["DraftComponentInput", "DraftEntryInput", "update"],
  ["PublishedComponentInput", "PublishedEntryInput", "create"],
  ["RestDraftCreateInput", "DraftCreateInput", "create"],
  ["RestPublishedCreateInput", "PublishedCreateInput", "create"],
  ["RestDraftUpdateInput", "DraftUpdateInput", "update"],
  ["RestPublishedUpdateInput", "PublishedUpdateInput", "update"],
  ["RestDraftCreateBody", "DraftCreateRequest", undefined],
  ["RestPublishedCreateBody", "PublishedCreateRequest", undefined],
  ["RestDraftUpdateBody", "DraftUpdateRequest", undefined],
  ["RestPublishedUpdateBody", "PublishedUpdateRequest", undefined],
  ["RestAnyDocument", "Document", "response"],
  ["RestDraftDocument", "DraftDocument", "response"],
  ["RestDraftZoneEntry", "DraftBlock", "response"],
  ["RestPublishedDocument", "PublishedDocument", "response"],
  ["RestPublishedZoneEntry", "PublishedBlock", "response"],
  ["RestCreateInput", "CreateInput", "create"],
  ["RestUpdateInput", "UpdateInput", "update"],
];

const CONDITION_MODES: ReadonlyMap<string, Mode | undefined> = new Map(
  VARIANTS.map(([, suffix, mode]) => [suffix, mode]),
);

const HASH = /-x[0-9A-F]{16}$/u;
const ESCAPED_CHARACTER = /_x(?<code>[0-9A-F]{2})_/gu;
const HEXADECIMAL = 16;

const readableSchemaName = (name: string): string => {
  if (!HASH.test(name)) {
    return name;
  }
  const alias = VARIANTS.find(([generic]) => name.startsWith(generic));
  if (alias === undefined) {
    return name;
  }
  const uid = name
    .slice(alias[0].length)
    .replace(HASH, "")
    .replaceAll(ESCAPED_CHARACTER, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, HEXADECIMAL)),
    );

  return `${pascalCase(uid)}${alias[1]}`;
};

const documentUnion = (
  schema: JsonSchema,
  documents: Map<string, string>,
  root: string,
): JsonSchema | undefined => {
  const alternatives = schema["oneOf"] ?? schema["anyOf"];
  if (!isUnknownArray(alternatives)) {
    return undefined;
  }
  const references = alternatives
    .map((entry) => toRecord(entry)["$ref"])
    .filter((reference) => typeof reference === "string");
  const document = documents.get(references.toSorted().join("\n"));
  if (document === undefined) {
    return undefined;
  }
  const ref = { $ref: `#/components/schemas/${document}` };
  if (alternatives.length <= 2) {
    return root === document ? { anyOf: alternatives } : ref;
  }
  // Preserve non-state alternatives, such as a nullable relation.
  return {
    ...schema,
    [schema["oneOf"] === undefined ? "anyOf" : "oneOf"]: [
      ...alternatives.filter((entry) => toRecord(entry)["$ref"] === undefined),
      ref,
    ],
  };
};

// Fields can omit publishedAt, so projected documents can match both state schemas.
const responseUnions = (
  schemas: Record<string, unknown>,
): Record<string, JsonSchema> => {
  const documents = new Map<string, string>();
  for (const name of Object.keys(schemas)) {
    if (name.endsWith("PublishedDocument")) {
      const prefix = name.slice(0, -"PublishedDocument".length);
      const document = `${prefix}Document`;
      const draftName = `${prefix}DraftDocument`;
      const published = `#/components/schemas/${name}`;
      if (draftName in schemas) {
        const draft = `#/components/schemas/${draftName}`;
        documents.set([published, draft].toSorted().join("\n"), document);
        schemas[document] = { anyOf: [{ $ref: published }, { $ref: draft }] };
      } else {
        schemas[document] ??= { $ref: published };
      }
    }
  }

  const visit = (value: unknown, root = ""): unknown => {
    if (isUnknownArray(value)) {
      return value.map((entry) => visit(entry));
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    const schema = toRecord(value);
    return (
      documentUnion(schema, documents, root) ??
      Object.fromEntries(
        Object.entries(schema).map(([key, entry]) => [key, visit(entry)]),
      )
    );
  };

  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      schema === false ? { not: {} } : toRecord(visit(schema, name)),
    ]),
  );
};

/** Rename typia's schemas and references together, rejecting ambiguous public names. */
const renameSchemas = (
  schemas: Record<string, unknown>,
): Record<string, JsonSchema> => {
  // A name appears as a key and inside each "$ref" to it, so rename in the JSON text.
  let text = JSON.stringify(schemas);
  const originals = new Map<string, string>();
  for (const name of Object.keys(schemas)) {
    const readable = readableSchemaName(name);
    const previous = originals.get(readable);
    if (previous !== undefined) {
      throw new Error(
        `Two generated schemas were renamed to the same name: ${previous} and ${name} both become ${readable}`,
      );
    }
    originals.set(readable, name);
    if (readable !== name) {
      text = text.replaceAll(name, readable);
    }
  }
  return responseUnions(parseJsonObject(text));
};

export { CONDITION_MODES, renameSchemas };
