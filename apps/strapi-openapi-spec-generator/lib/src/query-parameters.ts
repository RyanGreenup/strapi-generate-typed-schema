/** One OpenAPI parameter object. */
type Parameter = Record<string, unknown>;

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
const stringParameter = { schema: stringSchema };
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

const query = (
  name: string,
  description: string,
  options: Parameter = stringParameter,
): Parameter => ({ description, in: "query", name, ...options });

/** Query descriptors for Strapi's core REST actions. */
const QUERY_PARAMETERS: Record<QueryName, Parameter> = {
  fields: query("fields", "Scalar fields to return", {
    schema: { anyOf: [stringSchema, stringList] },
  }),
  filters: query("filters", "Attribute filters and $and / $or / $not", {
    ...deepObject,
    schema: { type: "object" },
  }),
  hasPublishedVersion: {
    deprecated: true,
    ...query("hasPublishedVersion", "Deprecated: use publicationFilter", {
      schema: booleanParameter,
    }),
  },
  locale: query("locale", "Locale code"),
  pagination: query(
    "pagination",
    "Page-based (page, pageSize) or offset-based (start, limit) pagination, not both",
    {
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
  ),
  populate: query("populate", "'*', field names, or a nested populate object", {
    ...deepObject,
    schema: { anyOf: [stringSchema, stringList, { type: "object" }] },
  }),
  publicationFilter: query("publicationFilter", "Derived publication cohort", {
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
  }),
  search: query("_q", "Full-text search"),
  sort: query("sort", "Sort the result", {
    ...deepObject,
    schema: {
      anyOf: [
        sortKey,
        { items: { anyOf: [sortKey, sortObject] }, type: "array" },
        sortObject,
      ],
    },
  }),
  status: query("status", "Document status, defaults to published", {
    schema: { enum: ["draft", "published"], type: "string" },
  }),
};

export { QUERY_PARAMETERS };
export type { Parameter };
