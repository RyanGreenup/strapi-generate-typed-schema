import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DocumentInfo, OpenApiDocument } from "./document.js";

import { readContentTypes } from "./content-types.js";
import { buildDocument } from "./document.js";
import { parseJsonObject, toOptionalString } from "./json.js";
import { readRoutes } from "./routes.js";
import { schemaRefName } from "./schema-names.js";
import { generateSchemas } from "./schemas.js";

/** Project root and optional overrides for the REST prefix and compiler cache. */
interface SpecificationOptions {
  cacheDirectory?: string;
  projectDirectory: string;
  serverUrl?: string;
}

/** Generated content API document and diagnostics for unsupported input. */
interface Specification {
  document: OpenApiDocument;
  warnings: string[];
}

/**
 * Read the document's `info` block from the project's package.json.
 *
 * @param projectDirectory - The root directory of the Strapi project.
 * @returns The title, version and description.
 * @throws If the manifest cannot be read or parsed.
 */
const readInfo = async (projectDirectory: string): Promise<DocumentInfo> => {
  const file = path.join(projectDirectory, "package.json");
  const text = await readFile(file, "utf8").catch((error: unknown) => {
    throw new Error(
      `${projectDirectory} is not a Strapi project: ${file} does not exist.`,
      { cause: error },
    );
  });
  const manifest = parseJsonObject(text);
  const description = toOptionalString(manifest["description"]);

  return {
    title:
      toOptionalString(manifest["name"]) ?? path.basename(projectDirectory),
    version: toOptionalString(manifest["version"]) ?? "0.0.0",
    ...(description !== undefined && { description }),
  };
};

// Operations contain generator-owned parameter, body, response and status descriptors.
// Model schemas need a separate, keyword-aware walk: their examples are user data.
const checkOperationRefs = (
  value: unknown,
  document: OpenApiDocument,
): void => {
  if (value === null || typeof value !== "object") {
    return;
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, child] of entries) {
    if (key === "$ref" && typeof child === "string" && child.startsWith("#")) {
      const target = schemaRefName(child);
      if (
        target === undefined ||
        !Object.hasOwn(document.components.schemas, target)
      ) {
        throw new Error(`Unresolved operation schema reference: ${child}`);
      }
    } else {
      checkOperationRefs(child, document);
    }
  }
};

/**
 * Generate the content API contract without starting Strapi or writing to its project.
 * @param options - Project root, optional compiler cache and REST URL prefix.
 * @returns The OpenAPI document and warnings for routes or conditions not understood.
 * @throws If models, installed dependencies or generated types are missing or invalid.
 */
export const generateSpecification = async (
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
      cacheDirectory:
        options.cacheDirectory ??
        path.join(os.homedir(), ".cache", "strapi-openapi-spec-generator"),
      contentTypes,
      projectDirectory,
    },
    warnings,
  );

  const document = buildDocument({
    contentTypes,
    info,
    routes,
    schemas,
    serverUrl: options.serverUrl ?? "/api",
  });
  checkOperationRefs(document.paths, document);
  return { document, warnings };
};

export type { Specification, SpecificationOptions };
