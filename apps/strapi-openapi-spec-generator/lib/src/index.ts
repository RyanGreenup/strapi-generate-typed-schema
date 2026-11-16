import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DocumentInfo, OpenApiDocument } from "./document.js";

import { readContentTypes } from "./content-types.js";
import { buildDocument } from "./document.js";
import { parseJsonObject, toOptionalString } from "./json.js";
import { readRoutes } from "./routes.js";
import { generateSchemas } from "./schemas.js";

/** Options of `generateSpecification`. */
interface SpecificationOptions {
  /**
   * Directory for the compiled typia plugin and the work directories. Defaults to
   * `strapi-openapi-spec-generator` in the user's cache directory.
   */
  cacheDirectory?: string;
  /** The root directory of the Strapi project. */
  projectDirectory: string;
  /** The REST prefix of the project (`api.rest.prefix`). Defaults to "/api". */
  serverUrl?: string;
}

/** The result of `generateSpecification`. */
interface Specification {
  document: OpenApiDocument;
  /** Routes and options that could not be read from the project's source. */
  warnings: string[];
}

/**
 * Choose the default cache directory.
 *
 * @returns `~/.cache/strapi-openapi-spec-generator`.
 */
const defaultCacheDirectory = (): string =>
  path.join(os.homedir(), ".cache", "strapi-openapi-spec-generator");

/**
 * Read the document's `info` block from the project's package.json.
 *
 * @param projectDirectory - The root directory of the Strapi project.
 * @returns The title, version and description.
 * @throws {Error} When the directory has no package.json.
 */
const readInfo = async (projectDirectory: string): Promise<DocumentInfo> => {
  const file = path.join(projectDirectory, "package.json");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error: unknown) {
    throw new Error(
      `${projectDirectory} is not a Strapi project: ${file} does not exist.`,
      {
        cause: error,
      },
    );
  }
  const manifest = parseJsonObject(text);
  const description = toOptionalString(manifest["description"]);

  return {
    title:
      toOptionalString(manifest["name"]) ?? path.basename(projectDirectory),
    version: toOptionalString(manifest["version"]) ?? "0.0.0",
    ...(description !== undefined && { description }),
  };
};

/**
 * Generate the OpenAPI 3.1 document of a Strapi 5 project's content API.
 *
 * The project is only read. It must have its dependencies installed and its generated types
 * (`strapi ts:generate-types`). Strapi is not started and no database is needed.
 *
 * @param options - The project directory and optional settings.
 * @returns The document and the warnings for what could not be read.
 * @throws {Error} When the project is not ready or has no content types.
 */
const generateSpecification = async (
  options: SpecificationOptions,
): Promise<Specification> => {
  const projectDirectory = path.resolve(options.projectDirectory);
  const info = await readInfo(projectDirectory);
  const contentTypes = await readContentTypes(projectDirectory);
  if (contentTypes.length === 0) {
    throw new Error(
      `No content types were found in ${path.join(projectDirectory, "src", "api")}.`,
    );
  }
  const { routes, warnings } = await readRoutes(projectDirectory, contentTypes);
  const schemas = await generateSchemas(
    {
      cacheDirectory: options.cacheDirectory ?? defaultCacheDirectory(),
      contentTypes,
      projectDirectory,
    },
    warnings,
  );

  return {
    document: buildDocument({
      contentTypes,
      info,
      routes,
      schemas,
      serverUrl: options.serverUrl ?? "/api",
    }),
    warnings,
  };
};

export { defaultCacheDirectory, generateSpecification };
export type { Specification, SpecificationOptions };
export type { ContentType } from "./content-types.js";
export type {
  DocumentInfo,
  DocumentInput,
  JsonSchema,
  OpenApiDocument,
  Operation,
} from "./document.js";
export type { CoreAction, Route, RoutesResult } from "./routes.js";
export type { SchemasInput } from "./work-directory.js";
export { readContentTypes } from "./content-types.js";
export { buildDocument } from "./document.js";
export { readRoutes, readRouteSource } from "./routes.js";
export { generateSchemas } from "./schemas.js";
export { entrySource } from "./work-directory.js";
