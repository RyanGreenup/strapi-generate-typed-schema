import type { JsonSchema } from "./document.js";

import { parseJsonObject, toRecord } from "./json.js";
import { pascalCase } from "./names.js";

/**
 * The generic types of templates/rest-types.ts, and the suffix that replaces each one in a
 * schema name. `RestAnyDocument<"api::page.page">` becomes "ApiPagePageDocument".
 */
const SUFFIXES: Record<string, string> = {
  ComponentInput: "EntryInput",
  RestAnyDocument: "Document",
  RestAnyZoneEntry: "Block",
  RestCreateInput: "CreateInput",
  RestUpdateInput: "UpdateInput",
  ZoneEntryInput: "BlockInput",
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
  for (const name of Object.keys(schemas)) {
    const readable = readableSchemaName(name);
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
  if (Object.keys(renamed).length !== Object.keys(schemas).length) {
    throw new Error("Two generated schemas were renamed to the same name");
  }

  return renamed;
};

export { readableSchemaName, renameSchemas };
