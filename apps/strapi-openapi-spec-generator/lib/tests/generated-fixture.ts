import type { ValidateFunction } from "ajv";

import addFormats from "ajv-formats";
import { Ajv2020 } from "ajv/dist/2020.js";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";

import type { JsonSchema, OpenApiDocument } from "../src/document.js";

import { generateSpecification } from "../src/index.js";
import { isUnknownArray, toRecord } from "../src/json.js";

const GENERATION_TIMEOUT = 600_000;

interface GeneratedFixture {
  directory?: string;
  document?: OpenApiDocument;
  warnings: string[];
  compileSchema: (schema: JsonSchema) => ValidateFunction;
  validateDocument: (name: string) => ValidateFunction;
  validateQuery: (route: string, name: string) => ValidateFunction;
}

const createGeneratedProject = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "strapi-openapi-test-"),
  );
  try {
    const project = fileURLToPath(new URL("fixtures/project", import.meta.url));
    const declarations = fileURLToPath(
      new URL("fixtures/generated-types", import.meta.url),
    );
    const generated = path.join(directory, "types", "generated");
    const modules = path.join(directory, "node_modules", "@strapi");
    const strapiManifest = createRequire(import.meta.url).resolve(
      "@strapi/strapi/package.json",
    );
    await cp(project, directory, { recursive: true });
    await mkdir(generated, { recursive: true });
    await mkdir(modules, { recursive: true });
    await cp(declarations, generated, { recursive: true });
    await symlink(path.dirname(strapiManifest), path.join(modules, "strapi"));
    return directory;
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
};

/**
 * Register generation and cleanup for an isolated fixture project.
 *
 * @param customize - Optional source changes made before specification generation.
 * @returns The generated document, warnings and AJV compilation helpers.
 */
export const generatedFixture = (
  customize?: (directory: string) => Promise<void>,
): GeneratedFixture => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const fixture: GeneratedFixture = {
    warnings: [],
    compileSchema: (schema) =>
      ajv.compile({ components: fixture.document?.components, ...schema }),
    validateDocument: (name) =>
      fixture.compileSchema({ $ref: `#/components/schemas/${name}` }),
    validateQuery: (route, name) => {
      const parameters =
        fixture.document?.paths[route]?.["get"]?.["parameters"];
      const parameter = isUnknownArray(parameters)
        ? parameters.find((value) => toRecord(value)["name"] === name)
        : undefined;
      const schema = toRecord(parameter)["schema"];
      if (schema === undefined) {
        throw new Error(`No ${name} schema for ${route}`);
      }
      return fixture.compileSchema(toRecord(schema));
    },
  };

  beforeAll(async () => {
    const directory = await createGeneratedProject();
    fixture.directory = directory;
    await customize?.(directory);
    ({ document: fixture.document, warnings: fixture.warnings } =
      await generateSpecification({ projectDirectory: directory }));
  }, GENERATION_TIMEOUT);

  afterAll(async () => {
    if (fixture.directory !== undefined) {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  return fixture;
};
