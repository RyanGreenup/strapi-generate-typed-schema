import type { JsonSchema } from "./document.js";

import { parseJsonObject, toRecord } from "./json.js";
import { pascalCase } from "./names.js";

/**
 * The generic types of templates/rest-types.ts, and the suffix that replaces each one in a
 * schema name. `RestAnyDocument<"api::page.page">` becomes "ApiPagePageDocument".
 */
const SUFFIXES: Record<string, string> = {
  DraftCreateComponentInput: "DraftCreateEntryInput",
  PublishedCreateComponentInput: "PublishedCreateEntryInput",
  DraftCreateZoneInput: "DraftCreateBlockInput",
  PublishedCreateZoneInput: "PublishedCreateBlockInput",
  DraftUpdateZoneInput: "DraftUpdateBlockInput",
  PublishedUpdateZoneInput: "PublishedUpdateBlockInput",
  DraftComponentInput: "DraftEntryInput",
  PublishedComponentInput: "PublishedEntryInput",
  RestDraftCreateInput: "DraftCreateInput",
  RestPublishedCreateInput: "PublishedCreateInput",
  RestDraftUpdateInput: "DraftUpdateInput",
  RestPublishedUpdateInput: "PublishedUpdateInput",
  RestDraftCreateBody: "DraftCreateRequest",
  RestPublishedCreateBody: "PublishedCreateRequest",
  RestDraftUpdateBody: "DraftUpdateRequest",
  RestPublishedUpdateBody: "PublishedUpdateRequest",
  RestAnyDocument: "Document",
  RestDraftDocument: "DraftDocument",
  RestDraftZoneEntry: "DraftBlock",
  RestPublishedDocument: "PublishedDocument",
  RestPublishedZoneEntry: "PublishedBlock",
  RestCreateInput: "CreateInput",
  RestUpdateInput: "UpdateInput",
};

/** typia ends the name of a generic type with a hash of its arguments. */
const HASH = /-x[0-9A-F]{16}$/u;

/** typia writes a character that a schema name cannot hold as its code, for example "_x3A_". */
const ESCAPED_CHARACTER = /_x(?<code>[0-9A-F]{2})_/gu;

const HEXADECIMAL = 16;

/**
 * Give one generated schema a readable name.
 *
 * typia names a generic type after its arguments, for example
 * "RestAnyDocumentapi_x3A__x3A_page_x2E_page-x7AB9B112138960C0".
 *
 * @param name - The name typia generated.
 * @returns The name Strapi uses for the UID plus a suffix, or `name` when it is not generic.
 */
const readableSchemaName = (name: string): string => {
  const alias = Object.keys(SUFFIXES).find((key) => name.startsWith(key));
  if (alias === undefined || !HASH.test(name)) {
    return name;
  }
  const uid = name
    .slice(alias.length)
    .replace(HASH, "")
    .replaceAll(ESCAPED_CHARACTER, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, HEXADECIMAL)),
    );

  return `${pascalCase(uid)}${SUFFIXES[alias] ?? ""}`;
};

const documentUnion = (
  schema: JsonSchema,
  document: string,
  root: string,
): JsonSchema => {
  const variants = schema["oneOf"] ?? schema["anyOf"];
  const alternatives: unknown[] = Array.isArray(variants) ? variants : [];
  if (alternatives.length > 2) {
    return {
      ...schema,
      [schema["oneOf"] === undefined ? "anyOf" : "oneOf"]: [
        ...alternatives.filter(
          (entry) => toRecord(entry)["$ref"] === undefined,
        ),
        { $ref: `#/components/schemas/${document}` },
      ],
    };
  }
  return root === document
    ? { anyOf: variants }
    : { $ref: `#/components/schemas/${document}` };
};

/**
 * Preserve named document unions and make only publication-state unions non-exclusive.
 * `fields` can omit publishedAt, so a valid entry can match both state schemas.
 */
const responseUnions = (
  schemas: Record<string, JsonSchema>,
): Record<string, JsonSchema> => {
  const documents = new Map<string, string>();
  for (const name of Object.keys(schemas)) {
    if (name.endsWith("PublishedDocument")) {
      const prefix = name.slice(0, -"PublishedDocument".length);
      const document = `${prefix}Document`;
      const published = `#/components/schemas/${name}`;
      const draft = `#/components/schemas/${prefix}DraftDocument`;
      if (`${prefix}DraftDocument` in schemas) {
        const variants = [{ $ref: published }, { $ref: draft }];
        documents.set([published, draft].toSorted().join("\n"), document);
        schemas[document] = { anyOf: variants };
      } else {
        schemas[document] ??= { $ref: published };
      }
    }
  }

  const unionDocument = (variants: unknown): string | undefined => {
    if (!Array.isArray(variants)) {
      return undefined;
    }
    const references = variants
      .map((entry: unknown) => toRecord(entry)["$ref"])
      .filter(
        (reference): reference is string => typeof reference === "string",
      );
    return documents.get(references.toSorted().join("\n"));
  };

  const visit = (value: unknown, root: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry: unknown) => visit(entry, ""));
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    const schema = toRecord(value);
    const variants = schema["oneOf"] ?? schema["anyOf"];
    const document = unionDocument(variants);
    if (document !== undefined) {
      return documentUnion(schema, document, root);
    }
    return Object.fromEntries(
      Object.entries(schema).map(([key, entry]) => [key, visit(entry, "")]),
    );
  };

  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      toRecord(visit(schema, name)),
    ]),
  );
};

/**
 * Give every generated schema a readable name, and update the references to it.
 *
 * @param schemas - The component schemas that typia generated.
 * @returns The same schemas under readable names.
 * @throws {Error} When two schemas would get the same name.
 */
const renameSchemas = (
  schemas: Record<string, JsonSchema>,
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
  const renamed = Object.fromEntries(
    Object.entries(parseJsonObject(text)).map(([name, schema]) => [
      name,
      toRecord(schema),
    ]),
  );

  return responseUnions(renamed);
};

export { readableSchemaName, renameSchemas };
