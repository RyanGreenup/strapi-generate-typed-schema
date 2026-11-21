import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { ContentType } from "./content-types.js";

import { readApis } from "./content-types.js";
import { toOptionalString, toRecord } from "./json.js";
import { staticValue } from "./static-value.js";

const CORE_ROUTES = {
  collectionType: [
    ["find", "get", ""],
    ["findOne", "get", "/:id"],
    ["create", "post", ""],
    ["update", "put", "/:id"],
    ["delete", "delete", "/:id"],
  ],
  singleType: [
    ["find", "get", ""],
    ["update", "put", ""],
    ["delete", "delete", ""],
  ],
} as const;

/** An action implemented by Strapi's core controller. */
type CoreAction = (typeof CORE_ROUTES)["collectionType"][number][0];

/** A content API route with a lowercase method and a path relative to the REST prefix. */
interface Route {
  auth: boolean;
  coreAction?: CoreAction;
  handler: string | undefined;
  method: string;
  path: string;
}

interface RoutesResult {
  routes: Route[];
  warnings: string[];
}

interface RouteFileContext {
  apiName: string;
  contentTypes: ContentType[];
  file: string;
}

const ROUTE_FILE = /\.(?:ts|js|mts|mjs|cts|cjs)$/u;

const isCoreRouterCall = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;

  return ts.isIdentifier(name) && name.text === "createCoreRouter";
};

const isRouterObject = (node: ts.Node): node is ts.ObjectLiteralExpression =>
  ts.isObjectLiteralExpression(node) &&
  node.properties.some(
    (property) =>
      property.name !== undefined &&
      ts.isIdentifier(property.name) &&
      property.name.text === "routes",
  );

const readCoreRouter = (
  call: ts.CallExpression,
  context: RouteFileContext,
  result: RoutesResult,
): void => {
  const [uidNode, optionsNode] = call.arguments;
  const uid = staticValue(uidNode);
  const model = context.contentTypes.find((type) => type.uid === uid);
  if (model === undefined) {
    result.warnings.push(
      `${context.file}: createCoreRouter is called for a content type that is not in src/api`,
    );
    return;
  }

  const { prefix, config, only, except } = toRecord(staticValue(optionsNode));
  const settings = toRecord(config);
  const name =
    model.kind === "singleType" ? model.singularName : model.pluralName;
  const base = `${toOptionalString(prefix) ?? ""}/${name}`;
  for (const [action, method, suffix] of CORE_ROUTES[model.kind]) {
    const included = !Array.isArray(only) || only.includes(action);
    const excluded = Array.isArray(except) && except.includes(action);
    if (included && !excluded) {
      result.routes.push({
        auth: toRecord(settings[action])["auth"] !== false,
        coreAction: action,
        handler: `${model.uid}.${action}`,
        method,
        path: `${base}${suffix}`,
      });
    }
  }
};

const resolveHandler = (
  handler: unknown,
  apiName: string,
): string | undefined => {
  if (typeof handler !== "string") {
    return undefined;
  }

  return handler.includes("::") ? handler : `api::${apiName}.${handler}`;
};

const readCustomRouter = (
  router: ts.ObjectLiteralExpression,
  context: RouteFileContext,
  result: RoutesResult,
): void => {
  const { type, routes, prefix } = toRecord(staticValue(router));
  if (type === "admin" || !Array.isArray(routes)) {
    return;
  }
  const base = toOptionalString(prefix) ?? "";
  for (const entry of routes) {
    const { config, handler, method, path: routePath } = toRecord(entry);
    if (typeof method === "string" && typeof routePath === "string") {
      result.routes.push({
        auth: toRecord(config)["auth"] !== false,
        handler: resolveHandler(handler, context.apiName),
        method: method.toLowerCase(),
        path: `${base}${routePath}`,
      });
    } else {
      result.warnings.push(
        `${context.file}: a route was skipped because its method or path is not a string literal`,
      );
    }
  }
};

const readRouteSource = (
  source: string,
  context: RouteFileContext,
): RoutesResult => {
  const core: ts.CallExpression[] = [];
  const custom: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (isCoreRouterCall(node)) {
      core.push(node);
    } else if (isRouterObject(node)) {
      custom.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(context.file, source, ts.ScriptTarget.Latest));

  // Core routes precede custom routes even when the custom literal appears first.
  const result: RoutesResult = { routes: [], warnings: [] };
  for (const call of core) {
    readCoreRouter(call, context, result);
  }
  for (const router of custom) {
    readCustomRouter(router, context, result);
  }
  if (core.length === 0 && custom.length === 0) {
    result.warnings.push(`${context.file}: no routes were found in this file`);
  }
  return result;
};

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

/** Read content API route files without executing their JavaScript or TypeScript. */
const readRoutes = async (
  projectDirectory: string,
  contentTypes: ContentType[],
): Promise<RoutesResult> => {
  const results = await readApis(
    projectDirectory,
    async (apiDirectory, apiName) => {
      const directory = path.join(apiDirectory, "routes");
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
    },
  );

  return {
    routes: results.flatMap((result) => result.routes),
    warnings: results.flatMap((result) => result.warnings),
  };
};

export { readRoutes };
export type { CoreAction, Route };
