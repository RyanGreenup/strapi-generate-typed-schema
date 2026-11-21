type SchemaNames = Record<"create" | "list" | "one" | "update", string>;

const ERROR_SCHEMA = "RestError";

/** Converts a Strapi UID such as "api::page.page" to "ApiPagePage". */
const pascalCase = (text: string): string =>
  text
    .split(/[^A-Za-z0-9]+/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/** Names the request and response components for one content type UID. */
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
