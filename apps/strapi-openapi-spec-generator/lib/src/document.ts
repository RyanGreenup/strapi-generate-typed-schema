import type { ContentType } from "./content-types.js";
import type { Parameter, QueryName } from "./query-parameters.js";
import type { CoreAction, Route } from "./routes.js";

import { ERROR_SCHEMA, schemaNames } from "./names.js";
import { QUERY_PARAMETERS } from "./query-parameters.js";

/** A JSON Schema object. */
type JsonSchema = Record<string, unknown>;

/** One OpenAPI operation object. */
type Operation = Record<string, unknown>;

/** An OpenAPI 3.1 document. */
interface OpenApiDocument {
  components: {
    schemas: Record<string, JsonSchema>;
    securitySchemes: Record<string, JsonSchema>;
  };
  info: DocumentInfo;
  openapi: "3.1.0";
  /** Operations by path, then by lower case HTTP method. */
  paths: Record<string, Record<string, Operation>>;
  servers: { url: string }[];
}

/** The `info` block of the document. */
interface DocumentInfo {
  description?: string;
  title: string;
  version: string;
}

/** Everything `buildDocument` needs. */
interface DocumentInput {
  contentTypes: ContentType[];
  info: DocumentInfo;
  routes: Route[];
  /** The component schemas, including every name that `schemaNames` returns. */
  schemas: Record<string, JsonSchema>;
  /** The REST prefix, for example "/api". */
  serverUrl: string;
}

/** How one core action behaves, for a collection type or for a single type. */
interface ActionSpec {
  /** Error statuses of the handler itself. A route that needs a token adds 401 and 403. */
  errors: number[];
  query: QueryName[];
  /** The request body: a create body, an update body, or none. */
  request?: "create" | "update";
  /** The success body: one entry, a page of entries, or none. */
  response?: "list" | "one";
  status: number;
  /** Summary, with `%s` in place of the content type name. */
  summary: string;
}

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;

/*
 * The statuses below were checked against a running Strapi 5:
 * - An unknown query parameter or an invalid body answers 400.
 * - Deleting an entry that does not exist answers 204, not 404.
 * - Updating a single type creates it, so update never answers 404 there.
 */
const COLLECTION_ACTIONS: Record<CoreAction, ActionSpec> = {
  create: {
    errors: [BAD_REQUEST],
    query: ["fields", "populate"],
    request: "create",
    response: "one",
    status: CREATED,
    summary: "Create one %s",
  },
  delete: {
    errors: [BAD_REQUEST],
    query: ["fields", "populate", "filters"],
    status: NO_CONTENT,
    summary: "Delete one %s",
  },
  find: {
    errors: [BAD_REQUEST],
    query: ["fields", "filters", "search", "pagination", "sort", "populate"],
    response: "list",
    status: OK,
    summary: "List %s entries",
  },
  findOne: {
    errors: [BAD_REQUEST, NOT_FOUND],
    query: ["fields", "populate", "filters", "sort"],
    response: "one",
    status: OK,
    summary: "Get one %s",
  },
  update: {
    errors: [BAD_REQUEST, NOT_FOUND],
    query: ["fields", "populate"],
    request: "update",
    response: "one",
    status: OK,
    summary: "Update one %s",
  },
};

const SINGLE_TYPE_ACTIONS: Partial<Record<CoreAction, ActionSpec>> = {
  delete: {
    errors: [BAD_REQUEST],
    query: ["fields", "populate"],
    status: NO_CONTENT,
    summary: "Delete the %s",
  },
  find: {
    errors: [BAD_REQUEST, NOT_FOUND],
    query: ["fields", "populate", "filters"],
    response: "one",
    status: OK,
    summary: "Get the %s",
  },
  update: {
    errors: [BAD_REQUEST],
    query: ["fields", "populate"],
    request: "update",
    response: "one",
    status: OK,
    summary: "Create or update the %s",
  },
};

const ERROR_DESCRIPTIONS: Record<number, string> = {
  [BAD_REQUEST]: "Invalid query parameter or request body",
  [FORBIDDEN]: "The token or the public role lacks permission",
  [NOT_FOUND]: "Not found",
  [UNAUTHORIZED]: "Missing or invalid token",
};

/**
 * Point at a component schema.
 *
 * @param name - The schema name.
 * @returns A JSON Schema reference.
 */
const reference = (name: string): JsonSchema => ({
  $ref: `#/components/schemas/${name}`,
});

/**
 * Wrap a schema as JSON content.
 *
 * @param name - The schema name.
 * @returns An OpenAPI `content` object.
 */
const jsonContent = (name: string): JsonSchema => ({
  "application/json": { schema: reference(name) },
});

/**
 * Rewrite a Strapi path for OpenAPI.
 *
 * @param routePath - A path such as "/articles/:id".
 * @returns The same path with braces, such as "/articles/{id}".
 */
const openApiPath = (routePath: string): string =>
  routePath.replaceAll(/:(?<name>\w+)(?:\([^)]*\))?/gu, "{$<name>}");

/**
 * Describe the path parameters of a route.
 *
 * @param routePath - A path in Strapi's form, such as "/articles/:id".
 * @returns One required parameter for each `:name` segment.
 */
const pathParameters = (routePath: string): Parameter[] =>
  [...routePath.matchAll(/:(?<name>\w+)/gu)].map((match) => {
    const name = match.groups?.["name"] ?? "";

    return {
      in: "path",
      name,
      required: true,
      schema:
        name === "id"
          ? { description: "Document id (cuid2)", minLength: 1, type: "string" }
          : { type: "string" },
    };
  });

/**
 * Describe the security and the token errors of a route.
 *
 * @param route - The route.
 * @param errors - The error statuses of the handler itself.
 * @returns The `security` list (empty means no authentication) and every error status.
 */
const security = (
  route: Route,
  errors: number[],
): { errors: number[]; security: JsonSchema[] } =>
  route.auth
    ? {
        errors: [...errors, UNAUTHORIZED, FORBIDDEN],
        security: [{ bearerAuth: [] }],
      }
    : { errors, security: [] };

/**
 * Describe the error responses of an operation.
 *
 * @param statuses - The error statuses.
 * @returns The responses by status.
 */
const errorResponses = (statuses: number[]): Record<string, JsonSchema> =>
  Object.fromEntries(
    statuses.map((status) => [
      String(status),
      {
        content: jsonContent(ERROR_SCHEMA),
        description: ERROR_DESCRIPTIONS[status] ?? "Error",
      },
    ]),
  );

/**
 * List the query parameters of a core action on a content type.
 *
 * @param spec - The core action.
 * @param contentType - The content type.
 * @returns The parameters, with the ones that depend on i18n and on draft and publish.
 */
const queryParameters = (
  spec: ActionSpec,
  contentType: ContentType,
): Parameter[] => {
  const names: QueryName[] = [
    ...spec.query,
    ...(contentType.localized ? (["locale"] as const) : []),
    ...(contentType.draftAndPublish
      ? (["status", "publicationFilter", "hasPublishedVersion"] as const)
      : []),
  ];

  return names.map((name) => QUERY_PARAMETERS[name]);
};

/**
 * Build the operation of a route whose handler is a core action.
 *
 * @param route - The route.
 * @param spec - The core action.
 * @param contentType - The content type that the action belongs to.
 * @returns The OpenAPI operation.
 */
const coreOperation = (
  route: Route,
  spec: ActionSpec,
  contentType: ContentType,
): Operation => {
  const names = schemaNames(contentType.uid);
  const access = security(route, spec.errors);
  const success =
    spec.response === undefined
      ? { description: "No Content" }
      : { content: jsonContent(names[spec.response]), description: "Success" };

  return {
    operationId: `${route.method} ${openApiPath(route.path)}`,
    parameters: [
      ...pathParameters(route.path),
      ...queryParameters(spec, contentType),
    ],
    ...(spec.request !== undefined && {
      requestBody: {
        content: jsonContent(names[spec.request]),
        required: true,
      },
      ...(contentType.draftAndPublish && {
        // OpenAPI cannot make a body schema depend on a query parameter.
        "x-strapi-request-status": {
          parameter: "status",
          default: "published",
          schemas: {
            draft: {
              $ref: `#/components/schemas/${names[spec.request].replace(/(Create|Update)Request$/u, "Draft$1Request")}`,
            },
            published: {
              $ref: `#/components/schemas/${names[spec.request].replace(/(Create|Update)Request$/u, "Published$1Request")}`,
            },
          },
        },
      }),
    }),
    responses: {
      [String(spec.status)]: success,
      ...errorResponses(access.errors),
    },
    security: access.security,
    summary: spec.summary.replace("%s", contentType.singularName),
    tags: [contentType.singularName],
  };
};

/**
 * Build the operation of a route whose handler is custom code.
 *
 * @param route - The route.
 * @returns An operation with the path parameters and security, but no body schemas.
 */
const customOperation = (route: Route): Operation => {
  const access = security(route, []);

  return {
    operationId: `${route.method} ${openApiPath(route.path)}`,
    parameters: pathParameters(route.path),
    responses: {
      default: {
        description:
          "Custom handler: its request and response shapes are not known from the content types",
      },
      ...errorResponses(access.errors),
    },
    security: access.security,
    summary: route.handler ?? "Custom route",
  };
};

/**
 * Find the core action behind a route.
 *
 * @param route - The route.
 * @param contentTypes - The content types of the project.
 * @returns The action and its content type, or `undefined` for a custom handler.
 */
const findCoreAction = (
  route: Route,
  contentTypes: ContentType[],
): { contentType: ContentType; spec: ActionSpec } | undefined => {
  // "api::article.article.find" is the action "find" on "api::article.article".
  const handler = route.handler ?? "";
  const split = handler.lastIndexOf(".");
  const contentType = contentTypes.find(
    (type) => type.uid === handler.slice(0, split),
  );
  if (contentType === undefined) {
    return undefined;
  }
  const actions: Partial<Record<string, ActionSpec>> =
    contentType.kind === "singleType"
      ? SINGLE_TYPE_ACTIONS
      : COLLECTION_ACTIONS;
  const spec = actions[handler.slice(split + 1)];

  return spec === undefined ? undefined : { contentType, spec };
};

/**
 * Build the OpenAPI document of a Strapi project's content API.
 *
 * @param input - The content types, routes and component schemas of the project.
 * @returns The document.
 */
const buildDocument = (input: DocumentInput): OpenApiDocument => {
  const paths: Record<string, Record<string, Operation>> = {};
  for (const route of input.routes) {
    const core = findCoreAction(route, input.contentTypes);
    const operation =
      core === undefined
        ? customOperation(route)
        : coreOperation(route, core.spec, core.contentType);
    const key = openApiPath(route.path);
    paths[key] = { ...paths[key], [route.method]: operation };
  }

  return {
    components: {
      schemas: input.schemas,
      securitySchemes: { bearerAuth: { scheme: "bearer", type: "http" } },
    },
    info: input.info,
    openapi: "3.1.0",
    paths,
    servers: [{ url: input.serverUrl }],
  };
};

export { buildDocument };
export type {
  DocumentInfo,
  DocumentInput,
  JsonSchema,
  OpenApiDocument,
  Operation,
};
