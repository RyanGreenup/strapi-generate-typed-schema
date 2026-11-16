/** One OpenAPI parameter object. */
type Parameter = Record<string, unknown>;

/** The names of the query parameters that the core routes accept. */
type QueryName =
  | "fields"
  | "filters"
  | "hasPublishedVersion"
  | "locale"
  | "pagination"
  | "populate"
  | "publicationFilter"
  | "search"
  | "sort"
  | "status";

const deepObject = { explode: true, style: "deepObject" };
const stringSchema = { type: "string" };
const stringList = { items: stringSchema, type: "array" };
const booleanParameter = {
  anyOf: [{ type: "boolean" }, { enum: ["true", "false"], type: "string" }],
};
const sortKey = {
  description:
    "field, field:asc or field:desc; comma-separated or nested with dots",
  type: "string",
};
const sortObject = {
  additionalProperties: {
    enum: ["asc", "desc", "ASC", "DESC"],
    type: "string",
  },
  type: "object",
};

/**
 * The query parameters of the core routes. They are written by hand because they are not
 * part of any request or response body type.
 */
const QUERY_PARAMETERS: Record<QueryName, Parameter> = {
  fields: {
    description: "Scalar fields to return",
    in: "query",
    name: "fields",
    schema: { anyOf: [stringSchema, stringList] },
  },
  filters: {
    description: "Attribute filters and $and / $or / $not",
    in: "query",
    name: "filters",
    ...deepObject,
    schema: { type: "object" },
  },
  hasPublishedVersion: {
    deprecated: true,
    description: "Deprecated: use publicationFilter",
    in: "query",
    name: "hasPublishedVersion",
    schema: booleanParameter,
  },
  locale: {
    description: "Locale code",
    in: "query",
    name: "locale",
    schema: stringSchema,
  },
  pagination: {
    description:
      "Page-based (page, pageSize) or offset-based (start, limit) pagination, not both",
    in: "query",
    name: "pagination",
    ...deepObject,
    schema: {
      properties: {
        limit: { type: "integer" },
        page: { exclusiveMinimum: 0, type: "integer" },
        pageSize: { exclusiveMinimum: 0, type: "integer" },
        start: { minimum: 0, type: "integer" },
        withCount: booleanParameter,
      },
      type: "object",
    },
  },
  populate: {
    description: "'*', field names, or a nested populate object",
    in: "query",
    name: "populate",
    ...deepObject,
    schema: { anyOf: [stringSchema, stringList, { type: "object" }] },
  },
  publicationFilter: {
    description: "Derived publication cohort",
    in: "query",
    name: "publicationFilter",
    schema: {
      enum: [
        "never-published",
        "has-published-version",
        "modified",
        "unmodified",
        "never-published-document",
        "has-published-version-document",
        "published-without-draft",
        "published-with-draft",
      ],
      type: "string",
    },
  },
  search: {
    description: "Full-text search",
    in: "query",
    name: "_q",
    schema: stringSchema,
  },
  sort: {
    description: "Sort the result",
    in: "query",
    name: "sort",
    ...deepObject,
    schema: {
      anyOf: [
        sortKey,
        { items: { anyOf: [sortKey, sortObject] }, type: "array" },
        sortObject,
      ],
    },
  },
  status: {
    description: "Document status, defaults to published",
    in: "query",
    name: "status",
    schema: { enum: ["draft", "published"], type: "string" },
  },
};

export { QUERY_PARAMETERS };
export type { Parameter, QueryName };
