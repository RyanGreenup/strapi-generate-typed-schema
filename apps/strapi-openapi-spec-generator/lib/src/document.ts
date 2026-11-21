import type { DiscoveredContentType } from "./content-types.js";
import type { Parameter, QueryEnums, QueryName } from "./query-parameters.js";
import type { CoreAction, Route } from "./routes.js";

import { ERROR_SCHEMA, schemaNames } from "./names.js";
import { createQueryParameters } from "./query-parameters.js";

type JsonSchema = Record<string, unknown>;

type Operation = Record<string, unknown>;

interface OpenApiDocument {
  components: {
    schemas: Record<string, JsonSchema>;
    securitySchemes: Record<string, JsonSchema>;
  };
  info: DocumentInfo;
  openapi: "3.1.0";
  paths: Record<string, Record<string, Operation>>;
  servers: { url: string }[];
}

interface DocumentInfo {
  description?: string;
  title: string;
  version: string;
}

interface DocumentInput {
  contentTypes: DiscoveredContentType[];
  queryEnums: QueryEnums;
  info: DocumentInfo;
  routes: Route[];
  schemas: Record<string, JsonSchema>;
  serverUrl: string;
}

interface ActionSpec {
  notFound?: true;
  query: QueryName[];
  request?: "create" | "update";
  response?: "list" | "one";
  summary: string;
}

const fields: QueryName[] = ["fields", "populate"];
const filtered: QueryName[] = [...fields, "filters"];

// Strapi returns 204 for a missing delete target. Single-type updates can create.
const COLLECTION_ACTIONS: Record<CoreAction, ActionSpec> = {
  create: {
    query: fields,
    request: "create",
    response: "one",
    summary: "Create one %s",
  },
  delete: { query: filtered, summary: "Delete one %s" },
  find: {
    query: ["fields", "filters", "search", "pagination", "sort", "populate"],
    response: "list",
    summary: "List %s entries",
  },
  findOne: {
    notFound: true,
    query: [...filtered, "sort"],
    response: "one",
    summary: "Get one %s",
  },
  update: {
    notFound: true,
    query: fields,
    request: "update",
    response: "one",
    summary: "Update one %s",
  },
};

const SINGLE_TYPE_ACTIONS: Partial<Record<CoreAction, ActionSpec>> = {
  delete: { query: fields, summary: "Delete the %s" },
  find: {
    notFound: true,
    query: filtered,
    response: "one",
    summary: "Get the %s",
  },
  update: {
    query: fields,
    request: "update",
    response: "one",
    summary: "Create or update the %s",
  },
};

interface CoreHandler {
  contentType: DiscoveredContentType;
  spec: ActionSpec;
}

const reference = (name: string): JsonSchema => ({
  $ref: `#/components/schemas/${name}`,
});

const jsonContent = (name: string): JsonSchema => ({
  "application/json": { schema: reference(name) },
});

const errorResponse = (description: string): JsonSchema => ({
  content: jsonContent(ERROR_SCHEMA),
  description,
});

const fieldsParameter = (
  model: DiscoveredContentType,
  base: Parameter,
): Parameter => {
  const alternatives = [String.raw`\*`];
  for (const name of model.selectableFields) {
    alternatives.push(name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`));
  }
  const field = `(?:${alternatives.join("|")})`;
  const item = {
    pattern: `^\\s*${field}(?:\\s*,\\s*${field})*\\s*$`,
    type: "string",
  };
  return {
    ...base,
    schema: { anyOf: [item, { items: item, type: "array" }] },
  };
};

const routeParameters = (
  routePath: string,
  query: Record<QueryName, Parameter>,
  core?: CoreHandler,
): Parameter[] => {
  const parameters: Parameter[] = [];
  for (const match of routePath.matchAll(/:(?<name>\w+)/gu)) {
    const name = match.groups?.["name"] ?? "";

    parameters.push({
      in: "path",
      name,
      required: true,
      schema:
        name === "id"
          ? { description: "Document id (cuid2)", minLength: 1, type: "string" }
          : { type: "string" },
    });
  }
  if (core !== undefined) {
    parameters.push(
      ...core.spec.query.map((name) =>
        name === "fields"
          ? fieldsParameter(core.contentType, query.fields)
          : query[name],
      ),
    );
    if (core.contentType.localized) {
      parameters.push(query.locale);
    }
    if (core.contentType.draftAndPublish) {
      parameters.push(
        query.status,
        query.publicationFilter,
        query.hasPublishedVersion,
      );
    }
  }

  return parameters;
};

const requestFields = (name: string, draftAndPublish: boolean): Operation => {
  const suffix = /(?:Create|Update)Request$/u;
  const published = draftAndPublish
    ? name.replace(suffix, "Published$&")
    : name;
  return {
    requestBody: { content: jsonContent(published), required: true },
    ...(draftAndPublish && {
      // OpenAPI cannot make a body schema depend on a query parameter.
      "x-strapi-request-status": {
        parameter: "status",
        default: "published",
        schemas: {
          draft: reference(name.replace(suffix, "Draft$&")),
          published: reference(published),
        },
      },
    }),
  };
};

const findCoreAction = (
  route: Route,
  contentTypes: DiscoveredContentType[],
): CoreHandler | undefined => {
  const handler = route.handler ?? "";
  const split = handler.lastIndexOf(".");
  const uid = handler.slice(0, split);
  const contentType = contentTypes.find((type) => type.uid === uid);
  if (contentType === undefined) {
    return undefined;
  }
  const actions: Partial<Record<string, ActionSpec>> =
    contentType.kind === "singleType"
      ? SINGLE_TYPE_ACTIONS
      : COLLECTION_ACTIONS;
  const action = handler.slice(split + 1);
  const spec = Object.hasOwn(actions, action) ? actions[action] : undefined;

  return spec === undefined ? undefined : { contentType, spec };
};

const buildOperation = (
  route: Route,
  path: string,
  context: {
    contentTypes: DiscoveredContentType[];
    query: Record<QueryName, Parameter>;
  },
): Operation => {
  const core = findCoreAction(route, context.contentTypes);
  const common = {
    operationId: `${route.method} ${path}`,
    parameters: routeParameters(route.path, context.query, core),
  };
  const responses: Record<string, JsonSchema> = route.auth
    ? {
        "401": errorResponse("Missing or invalid token"),
        "403": errorResponse("The token or the public role lacks permission"),
      }
    : {};
  const access = {
    responses,
    security: route.auth ? [{ bearerAuth: [] }] : [],
  };
  if (core === undefined) {
    responses["default"] = {
      description:
        "Custom handler: its request and response shapes are not known from the content types",
    };

    return { ...common, ...access, summary: route.handler ?? "Custom route" };
  }
  const { contentType, spec } = core;
  const names = schemaNames(contentType.uid);
  responses["400"] = errorResponse("Invalid query parameter or request body");
  if (spec.notFound === true) {
    responses["404"] = errorResponse("Not found");
  }
  if (spec.response === undefined) {
    responses["204"] = { description: "No Content" };
  } else {
    responses[spec.request === "create" ? "201" : "200"] = {
      content: jsonContent(names[spec.response]),
      description: "Success",
    };
  }

  return {
    ...common,
    ...(spec.request !== undefined &&
      requestFields(names[spec.request], contentType.draftAndPublish)),
    ...access,
    summary: spec.summary.replace("%s", contentType.singularName),
    tags: [contentType.singularName],
  };
};

/** Builds the OpenAPI content API from extracted routes, content types and schemas. */
const buildDocument = (input: DocumentInput): OpenApiDocument => {
  const paths: OpenApiDocument["paths"] = {};
  const context = {
    contentTypes: input.contentTypes,
    query: createQueryParameters(input.queryEnums),
  };
  for (const route of input.routes) {
    const key = route.path.replaceAll(
      /:(?<name>\w+)(?:\([^)]*\))?/gu,
      "{$<name>}",
    );
    paths[key] = {
      ...paths[key],
      [route.method]: buildOperation(route, key, context),
    };
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
export type { DocumentInfo, JsonSchema, OpenApiDocument, Operation };
