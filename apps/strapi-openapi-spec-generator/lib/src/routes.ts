import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { ContentType } from "./content-types.js";
import type { StaticValue } from "./static-value.js";

import { listDirectories } from "./content-types.js";
import { asObject, asStrings, staticValue } from "./static-value.js";

/** The actions that Strapi's core controller implements. */
type CoreAction = "create" | "delete" | "find" | "findOne" | "update";

/** One content API route, read from a file in src/api/<apiName>/routes. */
interface Route {
  /** False when the route sets `config.auth` to `false`. */
  auth: boolean;
  /** For example "api::article.article.find". Undefined when it is not a string literal. */
  handler: string | undefined;
  /** Lower case HTTP method. */
  method: string;
  /** Path below the REST prefix in Strapi's form, for example "/articles/:id". */
  path: string;
}

/** The routes of a project and the things that could not be read from its source. */
interface RoutesResult {
  routes: Route[];
  warnings: string[];
}

/** What a route file needs to know about the project around it. */
interface RouteFileContext {
  apiName: string;
  contentTypes: ContentType[];
  /** Path of the route file, for warnings. */
  file: string;
}

/** A core action with the method and path suffix that createCoreRouter gives it. */
interface CoreRoute {
  action: CoreAction;
  method: string;
  suffix: string;
}

const COLLECTION_ROUTES: CoreRoute[] = [
  { action: "find", method: "get", suffix: "" },
  { action: "findOne", method: "get", suffix: "/:id" },
  { action: "create", method: "post", suffix: "" },
  { action: "update", method: "put", suffix: "/:id" },
  { action: "delete", method: "delete", suffix: "/:id" },
];

const SINGLE_TYPE_ROUTES: CoreRoute[] = [
  { action: "find", method: "get", suffix: "" },
  { action: "update", method: "put", suffix: "" },
  { action: "delete", method: "delete", suffix: "" },
];

const ROUTE_FILE = /\.(?:ts|js|mts|mjs|cts|cjs)$/u;

/**
 * Collect every node of a source file that a test accepts.
 *
 * @param root - The node to search, including its descendants.
 * @param accept - Returns true for the nodes to collect.
 * @returns The accepted nodes in source order.
 */
const collect = <Found extends ts.Node>(
  root: ts.Node,
  accept: (node: ts.Node) => node is Found,
): Found[] => {
  const found: Found[] = [];
  const visit = (node: ts.Node): void => {
    if (accept(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);

  return found;
};

/**
 * Test for a `createCoreRouter(...)` or `factories.createCoreRouter(...)` call.
 *
 * @param node - Any node.
 * @returns True when the node is such a call.
 */
const isCoreRouterCall = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;

  return ts.isIdentifier(name) && name.text === "createCoreRouter";
};

/**
 * Test for an object literal that has a `routes` property.
 *
 * @param node - Any node.
 * @returns True when the node is a custom router object.
 */
const isRouterObject = (node: ts.Node): node is ts.ObjectLiteralExpression =>
  ts.isObjectLiteralExpression(node) &&
  node.properties.some(
    (property) =>
      property.name !== undefined &&
      ts.isIdentifier(property.name) &&
      property.name.text === "routes",
  );

/**
 * Read the `auth` setting of a route config.
 *
 * @param config - The static value of a route's `config`.
 * @returns False only when the config sets `auth: false`.
 */
const readAuth = (config: StaticValue | undefined): boolean =>
  asObject(config)?.["auth"] !== false;

/**
 * Select the core actions that a createCoreRouter call keeps.
 *
 * @param routes - Every core route of the content type kind.
 * @param options - The static value of the second createCoreRouter argument.
 * @returns The routes left after `only` and `except`.
 */
const selectCoreRoutes = (
  routes: CoreRoute[],
  options: Record<string, StaticValue>,
): CoreRoute[] => {
  const only = asStrings(options["only"]);
  const except = asStrings(options["except"]) ?? [];

  return routes.filter(
    (route) =>
      (only === undefined || only.includes(route.action)) &&
      !except.includes(route.action),
  );
};

/**
 * Expand one createCoreRouter call into its routes.
 *
 * @param call - The call expression.
 * @param context - The route file and the content types of the project.
 * @returns The routes, or a warning when the content type is not known.
 */
const coreRouterRoutes = (
  call: ts.CallExpression,
  context: RouteFileContext,
): RoutesResult => {
  const [uidNode, optionsNode] = call.arguments;
  const uid = uidNode === undefined ? undefined : staticValue(uidNode);
  const contentType = context.contentTypes.find((type) => type.uid === uid);
  if (contentType === undefined) {
    return {
      routes: [],
      warnings: [
        `${context.file}: createCoreRouter is called for a content type that is not in src/api`,
      ],
    };
  }
  const options =
    asObject(optionsNode === undefined ? {} : staticValue(optionsNode)) ?? {};
  const single = contentType.kind === "singleType";
  const base = `${typeof options["prefix"] === "string" ? options["prefix"] : ""}/${
    single ? contentType.singularName : contentType.pluralName
  }`;
  const config = asObject(options["config"]) ?? {};
  const selected = selectCoreRoutes(
    single ? SINGLE_TYPE_ROUTES : COLLECTION_ROUTES,
    options,
  );

  return {
    routes: selected.map((route) => ({
      auth: readAuth(config[route.action]),
      handler: `${contentType.uid}.${route.action}`,
      method: route.method,
      path: `${base}${route.suffix}`,
    })),
    warnings: [],
  };
};

/**
 * Complete a handler name the way Strapi does.
 *
 * @param handler - The static value of a route's `handler`.
 * @param apiName - The API that owns the route file.
 * @returns The full handler name, or `undefined` when the handler is not a string.
 */
const resolveHandler = (
  handler: StaticValue | undefined,
  apiName: string,
): string | undefined => {
  if (typeof handler !== "string") {
    return undefined;
  }

  // "article.find" is short for "api::<apiName>.article.find".
  return handler.includes("::") ? handler : `api::${apiName}.${handler}`;
};

/**
 * Read the routes of one custom router object: `{ routes: [...] }`.
 *
 * @param router - The object literal.
 * @param context - The route file and the content types of the project.
 * @returns The routes, with a warning for each one that is not a literal.
 */
const customRouterRoutes = (
  router: ts.ObjectLiteralExpression,
  context: RouteFileContext,
): RoutesResult => {
  const value = asObject(staticValue(router)) ?? {};
  const result: RoutesResult = { routes: [], warnings: [] };
  // Admin routes are not part of the content API.
  if (value["type"] === "admin" || !Array.isArray(value["routes"])) {
    return result;
  }
  const prefix = typeof value["prefix"] === "string" ? value["prefix"] : "";
  for (const entry of value["routes"]) {
    const route = asObject(entry) ?? {};
    const { method, path: routePath } = route;
    if (typeof method === "string" && typeof routePath === "string") {
      result.routes.push({
        auth: readAuth(route["config"]),
        handler: resolveHandler(route["handler"], context.apiName),
        method: method.toLowerCase(),
        path: `${prefix}${routePath}`,
      });
    } else {
      result.warnings.push(
        `${context.file}: a route was skipped because its method or path is not a string literal`,
      );
    }
  }

  return result;
};

/**
 * Read the routes that one route file declares, without running the file.
 *
 * @param source - The text of the route file.
 * @param context - The route file and the content types of the project.
 * @returns The routes and the warnings for what could not be read.
 */
const readRouteSource = (
  source: string,
  context: RouteFileContext,
): RoutesResult => {
  const sourceFile = ts.createSourceFile(
    context.file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const results = [
    ...collect(sourceFile, isCoreRouterCall).map((call) =>
      coreRouterRoutes(call, context),
    ),
    ...collect(sourceFile, isRouterObject).map((router) =>
      customRouterRoutes(router, context),
    ),
  ];
  const routes = results.flatMap((result) => result.routes);
  const warnings = results.flatMap((result) => result.warnings);
  if (results.length === 0) {
    warnings.push(`${context.file}: no routes were found in this file`);
  }

  return { routes, warnings };
};

/**
 * List the route files of one API, in the order Strapi loads them.
 *
 * @param directory - The src/api/<apiName>/routes directory.
 * @returns The sorted file names, or an empty list when the directory does not exist.
 */
const listRouteFiles = async (directory: string): Promise<string[]> => {
  try {
    const names = await readdir(directory);

    return names
      .filter((name) => ROUTE_FILE.test(name) && !name.endsWith(".d.ts"))
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

/**
 * Read every route declared below src/api of a Strapi project.
 *
 * @param projectDirectory - The root directory of the Strapi project.
 * @param contentTypes - The content types of the project.
 * @returns The routes and the warnings for what could not be read.
 */
const readRoutes = async (
  projectDirectory: string,
  contentTypes: ContentType[],
): Promise<RoutesResult> => {
  const apiRoot = path.join(projectDirectory, "src", "api");
  // An API can declare routes without owning a content type.
  const apiNames = await listDirectories(apiRoot);
  const perApi = await Promise.all(
    apiNames.map(async (apiName) => {
      const directory = path.join(apiRoot, apiName, "routes");
      const files = await listRouteFiles(directory);

      return Promise.all(
        files.map(async (name) => {
          const file = path.join(directory, name);

          return readRouteSource(await readFile(file, "utf8"), {
            apiName,
            contentTypes,
            file: path.relative(projectDirectory, file),
          });
        }),
      );
    }),
  );
  const results = perApi.flat();

  return {
    routes: results.flatMap((result) => result.routes),
    warnings: results.flatMap((result) => result.warnings),
  };
};

export { readRouteSource, readRoutes };
export type { CoreAction, Route, RoutesResult };
