/** The schema names of one content type in the generated OpenAPI components. */
interface SchemaNames {
  /** Body of a create request. */
  create: string;
  /** Response with a page of entries. */
  list: string;
  /** Response with one entry. */
  one: string;
  /** Body of an update request. */
  update: string;
}

/** Name of the schema for the body of every error response. */
const ERROR_SCHEMA = "RestError";

/**
 * Turn a Strapi UID into the name Strapi itself uses for it in OpenAPI documents.
 *
 * @param text - A UID such as "api::page.page".
 * @returns The words of the UID in PascalCase, such as "ApiPagePage".
 */
const pascalCase = (text: string): string =>
  text
    .split(/[^A-Za-z0-9]+/u)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/**
 * Name the request and response schemas of a content type.
 *
 * @param uid - The content type UID, such as "api::page.page".
 * @returns The four schema names, such as "ApiPagePageResponse".
 */
const schemaNames = (uid: string): SchemaNames => {
  const name = pascalCase(uid);

  return {
    create: `${name}CreateRequest`,
    list: `${name}ListResponse`,
    one: `${name}Response`,
    update: `${name}UpdateRequest`,
  };
};

export { ERROR_SCHEMA, pascalCase, schemaNames };
export type { SchemaNames };
